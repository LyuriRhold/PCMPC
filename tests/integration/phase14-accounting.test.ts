import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { createBankAccountAction, registerAssetAction, runDepreciationAction, saveReconAction } from "@/modules/accounting/actions";
import { reconData, reconsDone } from "@/modules/accounting/bank";
import { depreciationOf, monthlyDepreciation } from "@/modules/accounting/assets";
import { accountSegments, assetClasses, bankRecons, depreciationRuns, fixedAssets, fsLineAccounts, fsLines } from "@/modules/accounting/schema";
import { seedFs } from "@/modules/accounting/seed";
import { cashFlows, changesInEquity, financialCondition, operations, unmappedAccounts } from "@/modules/accounting/statements";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { ensureFiscalYear } from "@/modules/ledger/periods";
import { accounts, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, trialBalance } from "@/modules/ledger/service";
import { P } from "../helpers/phase03";
import { fsPeople, on, postFixture, setupFs } from "../helpers/phase14";

beforeEach(async () => {
  await setupFs();
});
afterEach(() => setClock(null));

describe("T14.1 schema and the statement-line seed", () => {
  it("every postable account of the provisional chart is on one statement line of the right statement; revenue and expense accounts have a segment", async () => {
    const postable = await getDb().select().from(accounts).where(eq(accounts.isPostable, true));
    const maps = await getDb().select({ accountId: fsLineAccounts.accountId, statement: fsLines.statement, code: fsLines.code }).from(fsLineAccounts).innerJoin(fsLines, eq(fsLines.id, fsLineAccounts.fsLineId));
    const lineOf = new Map(maps.map((m) => [m.accountId, m]));
    for (const a of postable) {
      const m = lineOf.get(a.id);
      expect(m, `${a.code} ${a.name}`).toBeDefined();
      expect(m!.statement, a.code).toBe(["ASSET", "LIABILITY", "EQUITY"].includes(a.type) ? "SFC" : "SOO");
    }
    const byCode = (code: string) => lineOf.get(postable.find((a) => a.code === code)!.id)?.code;
    expect([byCode("11110"), byCode("11270"), byCode("11290"), byCode("12135"), byCode("21220"), byCode("43120"), byCode("44140"), byCode("53140")]).toEqual([
      "CASH",
      "SHARE_CAPITAL",
      "LOANS",
      "PPE_DEPRECIATION",
      "OTHER_PAYABLES",
      "SALES",
      "OTHER_INCOME",
      "OPERATING_EXPENSES",
    ]);
    const segs = await getDb().select({ code: accounts.code, segment: accountSegments.segmentCode }).from(accountSegments).innerJoin(accounts, eq(accounts.id, accountSegments.accountId));
    const seg = new Map(segs.map((s) => [s.code, s.segment]));
    expect(["41110", "52110", "44140", "42110", "43110", "51110", "53120"].map((c) => seg.get(c))).toEqual(["CREDIT", "CREDIT", "CREDIT", "WATER", "CONSUMER", "CONSUMER", "CONSUMER"]);
    expect(seg.get("53140")).toBeUndefined();
    expect((await getDb().select().from(assetClasses)).map((c) => c.code).sort()).toEqual(["BUILDING", "FURNITURE", "OFFICE_EQUIPMENT", "TRANSPORTATION", "WATER_SYSTEM"]);
  });

  it("the seed is idempotent and never moves an account already mapped", async () => {
    const before = await getDb().select().from(fsLineAccounts);
    const [other] = await getDb().select().from(fsLines).where(eq(fsLines.code, "OTHER_ASSETS"));
    const [cash] = await getDb().select().from(accounts).where(eq(accounts.code, "11130"));
    await getDb().update(fsLineAccounts).set({ fsLineId: other!.id }).where(eq(fsLineAccounts.accountId, cash!.id));
    await withTx((tx) => seedFs(tx));
    const after = await getDb().select().from(fsLineAccounts);
    expect(after).toHaveLength(before.length);
    expect(after.find((m) => m.accountId === cash!.id)?.fsLineId).toBe(other!.id);
  });

  it("closing records are never changed; fixed assets keep their terms", async () => {
    await getPool().query("INSERT INTO close_checklists (period, item, status, by) VALUES ('2026-01', 'x', 'PASS', $1)", [fsPeople().admin]);
    await expect(getPool().query("UPDATE close_checklists SET status = 'FAIL'")).rejects.toThrow(/immutable/);
    await expect(getPool().query("DELETE FROM close_checklists")).rejects.toThrow(/immutable/);
    await expect(getPool().query("INSERT INTO fixed_assets (tag, description, class_code, acquisition_date, cost, salvage, life_months) VALUES ('T1', 'x', 'OFFICE_EQUIPMENT', '2026-12-01', 100, 0, 0)")).rejects.toThrow(/fixed_assets_amounts_chk/);
  });
});

describe("T14.2 the statements", () => {
  beforeEach(async () => {
    await postFixture();
  });
  const amt = (s: { lines: Array<{ code: string; amount: bigint }> }, code: string) => s.lines.find((l) => l.code === code)?.amount;

  it("operations by segment: credit, consumer store and general", async () => {
    const soo = await operations("2026-01-01", "2026-12-31", { compare: { from: "2025-01-01", to: "2025-12-31" } });
    expect(soo.segments.map((s) => s.code)).toEqual(["WATER", "CREDIT", "CONSUMER", "GENERAL"]);
    expect(soo.segmentTotals).toEqual({
      WATER: { revenues: 0n, expenses: 0n, netSurplus: 0n },
      CREDIT: { revenues: P(20400), expenses: P(1000), netSurplus: P(19400) },
      CONSUMER: { revenues: P(70000), expenses: P(52000), netSurplus: P(18000) },
      GENERAL: { revenues: 0n, expenses: P(18000), netSurplus: -P(18000) },
    });
    expect(soo.lines.find((l) => l.code === "OPERATING_EXPENSES")).toMatchObject({ amount: P(18000), compare: 0n, bySegment: { GENERAL: P(18000) } });
    expect(soo.compareTotals).toEqual({ revenues: 0n, expenses: 0n, netSurplus: 0n });
    // A period without the fixture.
    expect((await operations("2026-12-16", "2026-12-31")).totals.netSurplus).toBe(0n);
  });

  it("financial condition balances, with a comparative", async () => {
    const sfc = await financialCondition("2026-12-31", { compareAsOf: "2026-11-30" });
    expect(sfc.totals).toEqual({ assets: P(170400), liabilities: P(51000), equity: P(119400), liabilitiesAndEquity: P(170400), balanced: true });
    expect(sfc.compareTotals).toMatchObject({ assets: 0n, balanced: true });
    expect(amt(sfc, "RECEIVABLES")).toBe(0n);
  });

  it("changes in equity: opening, the period's net surplus, other changes, closing", async () => {
    const sce = await changesInEquity("2026-01-01", "2026-12-31");
    expect(sce.rows.map((r) => [r.code, r.opening, r.netSurplus, r.transfers, r.other, r.closing])).toEqual([
      ["SHARE_CAPITAL", 0n, 0n, 0n, P(100000), P(100000)],
      ["STATUTORY_FUNDS", 0n, 0n, 0n, 0n, 0n],
      ["UNS", 0n, 0n, 0n, 0n, 0n],
      ["NET_SURPLUS", 0n, P(19400), 0n, 0n, P(19400)],
    ]);
    expect(sce.total).toMatchObject({ opening: 0n, closing: P(119400) });
  });

  it("cash flows: operating (net surplus and working capital), investing, financing", async () => {
    const cf = await cashFlows("2026-01-01", "2026-12-31");
    // 19,400 − 80,000 loans − 8,000 inventory + 51,000 deposits = −17,600; share capital +100,000.
    expect(cf.totals).toEqual({ operating: -P(17600), investing: 0n, financing: P(100000), netChange: P(82400), beginningCash: 0n, endingCash: P(82400) });
    expect(cf.lines.find((l) => l.code === "LOANS")).toMatchObject({ activity: "OPERATING", amount: -P(80000), caption: "Change in loans receivable, net of allowance" });
    // From December 16: nothing moved; the beginning cash is the fixture's.
    expect((await cashFlows("2026-12-16", "2026-12-31")).totals).toMatchObject({ netChange: 0n, beginningCash: P(82400), endingCash: P(82400) });
  });

  it("an account not on a statement line (or on the wrong statement) stops every statement, listed by code and name", async () => {
    const [parent] = await getDb().select().from(accounts).where(eq(accounts.code, "11000"));
    const [acct] = await getDb().insert(accounts).values({ code: "11190", name: "Petty Cash Fund", type: "ASSET", normalBalance: "DR", parentId: parent!.id, isPostable: true }).returning();
    await expect(cashFlows("2026-01-01", "2026-12-31")).rejects.toThrow("These accounts are not mapped to a statement line yet: 11190 Petty Cash Fund.");
    expect((await unmappedAccounts()).map((a) => a.code)).toEqual(["11190"]);
    const [soo] = await getDb().select().from(fsLines).where(eq(fsLines.code, "OTHER_INCOME"));
    await getDb().insert(fsLineAccounts).values({ fsLineId: soo!.id, accountId: acct!.id });
    await expect(financialCondition("2026-12-31")).rejects.toThrow(/11190 Petty Cash Fund/);
  });
});

describe("T14.3 fixed assets and depreciation", () => {
  const register = (o: Partial<Parameters<typeof registerAssetAction>[0]> = {}) =>
    runAs(fsPeople().bookkeeper, () => registerAssetAction({ tag: "FA-1", description: "Water pump", classCode: "WATER_SYSTEM", acquisitionDate: "2026-10-05", cost: "10,000.00", salvage: "1,000.00", lifeMonths: 7, ...o }));
  const run = (period: string) => runAs(fsPeople().bookkeeper, () => runDepreciationAction({ period }));

  it("straight-line monthly, HALF-UP; the last month takes the residue so the asset ends at its salvage value", () => {
    const asset = { acquisitionDate: "2026-10-05", cost: P(10000), salvage: P(1000), lifeMonths: 7, accumulated: 0n };
    expect(monthlyDepreciation(asset, "2026-09")).toBe(0n);
    expect(monthlyDepreciation(asset, "2026-10")).toBe(P(1285, 71)); // 9,000 ÷ 7 = 1,285.714…
    expect(monthlyDepreciation({ ...asset, accumulated: P(1285, 71) * 6n }, "2027-04")).toBe(P(1285, 74));
    expect(monthlyDepreciation({ ...asset, accumulated: P(9000) }, "2027-05")).toBe(0n);
  });

  it("the register: tag, class, cost, salvage and life are checked; terms never change", async () => {
    expect(await register({ cost: "0.00" })).toEqual({ ok: false, error: "The cost must be more than zero" });
    expect(await register({ salvage: "10,000.00" })).toEqual({ ok: false, error: "The salvage value is 0 or more and less than the cost" });
    expect(await register({ lifeMonths: 0 })).toEqual({ ok: false, error: "The useful life is 1 to 600 months" });
    expect(await register({ classCode: "SHIPS" })).toEqual({ ok: false, error: "Choose an asset class" });
    expect(await register({ acquisitionDate: "2026-12-16" })).toEqual({ ok: false, error: "The acquisition date can't be in the future" });
    await expect(runAs(fsPeople().teller, () => registerAssetAction({ tag: "X", description: "x", classCode: "WATER_SYSTEM", acquisitionDate: "2026-10-05", cost: "1.00", salvage: "0", lifeMonths: 1 }))).rejects.toBeInstanceOf(ForbiddenError);
    const a = await register({ tag: "fa-1" });
    if (!a.ok) throw new Error(a.error);
    expect(await register()).toEqual({ ok: false, error: "Asset tag FA-1 is already used" });
    await expect(getPool().query("UPDATE fixed_assets SET cost = 1 WHERE id = $1", [a.data.id])).rejects.toThrow(/don't change/);
    await expect(getPool().query("DELETE FROM fixed_assets WHERE id = $1", [a.data.id])).rejects.toThrow(/can't be deleted/);
  });

  it("runs go month by month, one entry per month (Dr Depreciation / Cr Accumulated Depreciation per class), until the asset is fully depreciated", async () => {
    const pump = await register();
    const pc = await register({ tag: "FA-2", description: "Computer", classCode: "OFFICE_EQUIPMENT", acquisitionDate: "2026-12-01", cost: "36,000.00", salvage: "0.00", lifeMonths: 36 });
    if (!pump.ok || !pc.ok) throw new Error("register");
    expect(await run("2026-11")).toEqual({ ok: false, error: "Run the depreciation for 2026-10 first" });
    expect(await run("2027-01")).toEqual({ ok: false, error: "2027-01 hasn't started yet" });
    expect(await run("2026-10")).toEqual({ ok: true, data: { total: "₱1,285.71", assets: 1 } });
    expect(await run("2026-11")).toEqual({ ok: true, data: { total: "₱1,285.71", assets: 1 } });
    const dec = await run("2026-12");
    expect(dec).toEqual({ ok: true, data: { total: "₱2,285.71", assets: 2 } });
    const [runRow] = await getDb().select().from(depreciationRuns).where(eq(depreciationRuns.period, "2026-12"));
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, runRow!.jeId!));
    const [exp, water, office] = [await accountIdFor("depreciation_expense"), await accountIdFor("accumulated_depreciation_WATER_SYSTEM"), await accountIdFor("accumulated_depreciation_OFFICE_EQUIPMENT")];
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [exp, P(2285, 71), 0n],
      [office, 0n, P(1000)],
      [water, 0n, P(1285, 71)],
    ]);
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, runRow!.jeId!));
    expect(je?.entryDate).toBe("2026-12-31");
    // The pump through its seventh month (April 2027): ₱9,000.00 in all, then nothing.
    for (const p of ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]) {
      on(`${p}-28`);
      await withTx((tx) => ensureFiscalYear(tx, 2027));
      expect((await run(p)).ok).toBe(true);
    }
    expect(await depreciationOf(pump.data.id, "2027-04")).toBe(P(1285, 74));
    expect(await depreciationOf(pump.data.id, "2027-05")).toBe(0n);
    const [done] = await getDb().select().from(fixedAssets).where(eq(fixedAssets.id, pump.data.id));
    expect(done).toMatchObject({ accumulated: P(9000), status: "FULLY_DEPRECIATED" });
    expect((await trialBalance("2027-12-31")).balanced).toBe(true);
  });
});

describe("T14.4 bank reconciliation", () => {
  /** Cash in Bank in December: a ₱10,000.00 deposit, check 101 for ₱3,000.00, check 102 for ₱1,500.00 (outstanding). */
  async function bankFixture() {
    const [bankGl, cash, fees] = [await accountIdFor("cash_in_bank"), await accountIdFor("cash_on_hand"), await accountIdFor("service_fee_income")];
    const post = (date: string, reference: string, lines: Parameters<typeof postJournal>[1]["lines"]) => withTx((tx) => postJournal(tx, { date, book: "GJ", particulars: reference, reference, lines }, fsPeople().bookkeeper));
    await post("2026-12-02", "DEP-1", [{ accountId: bankGl, debit: P(10000) }, { accountId: cash, credit: P(10000) }]);
    await post("2026-12-10", "CHK-101", [{ accountId: fees, debit: P(3000) }, { accountId: bankGl, credit: P(3000) }]);
    await post("2026-12-20", "CHK-102", [{ accountId: fees, debit: P(1500) }, { accountId: bankGl, credit: P(1500) }]);
    const b = await runAs(fsPeople().bookkeeper, () => createBankAccountAction({ name: "LBP current", bankName: "Land Bank", accountNo: "0011-2233-44", glAccountId: bankGl }));
    if (!b.ok) throw new Error(b.error);
    return { bankId: b.data.id, bankGl };
  }

  it("a bank account's GL account is a cash account, once", async () => {
    const fees = await accountIdFor("service_fee_income");
    expect(await runAs(fsPeople().bookkeeper, () => createBankAccountAction({ name: "X", bankName: "Y", accountNo: "1", glAccountId: fees }))).toEqual({ ok: false, error: "41120 Service Fee Income isn't a cash account" });
    const { bankGl } = await bankFixture();
    expect(await runAs(fsPeople().bookkeeper, () => createBankAccountAction({ name: "Again", bankName: "Y", accountNo: "2", glAccountId: bankGl }))).toEqual({ ok: false, error: "11130 Cash in Bank already belongs to a bank account" });
  });

  it("bank balance + deposits in transit − outstanding checks = book balance + bank-only items; saved once", async () => {
    const { bankId } = await bankFixture();
    on("2027-01-05");
    const data = await reconData(bankId, "2026-12");
    expect(data.bookBalance).toBe(P(5500));
    expect(data.open.map((l) => l.reference)).toEqual(["DEP-1", "CHK-101", "CHK-102"]);
    const cleared = data.open.filter((l) => l.reference !== "CHK-102").map((l) => l.id);
    const save = (bankBalance: string) =>
      runAs(fsPeople().bookkeeper, () => saveReconAction({ bankAccountId: bankId, period: "2026-12", bankBalance, clearedLineIds: cleared, bankItems: [{ date: "2026-12-31", description: "Bank service charge", amount: "-50.00" }] }));
    // Statement: 10,000 − 3,000 − 50 = 6,950. Adjusted bank 6,950 − 1,500 = 5,450 = book 5,500 − 50.
    expect(await save("6,900.00")).toEqual({ ok: false, error: "It doesn't reconcile: the adjusted bank balance differs from the adjusted book balance by -₱50.00" });
    expect((await save("6,950.00")).ok).toBe(true);
    const [recon] = await getDb().select().from(bankRecons).where(eq(bankRecons.bankAccountId, bankId));
    expect(recon).toMatchObject({ bookBalance: P(5500), bankBalance: P(6950), depositsInTransit: 0n, outstandingChecks: P(1500), adjustments: -P(50), difference: 0n });
    expect(await save("6,950.00")).toEqual({ ok: false, error: "LBP current is already reconciled for 2026-12" });
    // January: check 102 is still open until a statement clears it.
    on("2027-02-03");
    expect((await reconData(bankId, "2027-01")).open.map((l) => l.reference)).toEqual(["CHK-102"]);
    expect(await reconsDone("2026-12")).toEqual({ ok: true, detail: "1 reconciled" });
    expect(await reconsDone("2027-01")).toEqual({ ok: false, detail: "Not reconciled: LBP current" });
  });

  it("a month not over can't be reconciled", async () => {
    const { bankId } = await bankFixture();
    expect(await runAs(fsPeople().bookkeeper, () => saveReconAction({ bankAccountId: bankId, period: "2026-12", bankBalance: "0", clearedLineIds: [], bankItems: [] }))).toEqual({ ok: false, error: "2026-12 isn't over yet" });
  });
});
