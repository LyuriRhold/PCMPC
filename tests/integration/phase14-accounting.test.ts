import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import {
  closeMonthAction,
  createBankAccountAction,
  mapAccountAction,
  registerAssetAction,
  reopenMonthAction,
  runDepreciationAction,
  runMissedJobsAction,
  saveReconAction,
  setSegmentAction,
  voidAssetAction,
  yearEndCloseAction,
} from "@/modules/accounting/actions";
import { fsWorkbook } from "@/modules/accounting/export";
import { monthChecklist, yearPeriods } from "@/modules/accounting/close";
import { reconData, reconsDone } from "@/modules/accounting/bank";
import { depreciationOf, monthlyDepreciation, registerAsset } from "@/modules/accounting/assets";
import { accountSegments, assetClasses, bankRecons, closeChecklists, depreciationRuns, fixedAssets, fsLineAccounts, fsLines } from "@/modules/accounting/schema";
import { reverseJvAction } from "@/modules/ledger/actions";
import { auditLog } from "@/modules/audit/schema";
import { members } from "@/modules/members/schema";
import { depositAccounts, depositProducts } from "@/modules/savings/schema";
import { posShifts } from "@/modules/store/schema";
import { waterBillingPeriods, waterZones } from "@/modules/water/schema";
import { seedFs } from "@/modules/accounting/seed";
import { cashFlows, changesInEquity, financialCondition, mappingView, operations, unmappedAccounts } from "@/modules/accounting/statements";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { ensureFiscalYear } from "@/modules/ledger/periods";
import { accounts, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, trialBalance } from "@/modules/ledger/service";
import { P } from "../helpers/phase03";
import { makeUser } from "../helpers/phase01";
import { fsPeople, on, postFixture, runJobsThrough, setupFs } from "../helpers/phase14";

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
    expect([byCode("11110"), byCode("11270"), byCode("11290"), byCode("12135"), byCode("21220"), byCode("43120"), byCode("44140"), byCode("53210")]).toEqual([
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
    expect(seg.get("53210")).toBeUndefined();
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
    await expect(getPool().query("INSERT INTO fixed_assets (tag, description, class_code, acquisition_date, cost, salvage, life_months, depreciate_from) VALUES ('T1', 'x', 'OFFICE_EQUIPMENT', '2026-12-01', 100, 0, 0, '2026-12')")).rejects.toThrow(/fixed_assets_amounts_chk/);
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

  it("a bank account counts from the month it was set up; months are reconciled in order", async () => {
    const { bankId } = await bankFixture(); // set up on Dec 15, 2026
    expect(await reconsDone("2026-11")).toEqual({ ok: true, detail: "No bank accounts set up" });
    on("2027-02-03");
    const jan = await reconData(bankId, "2027-01");
    const save = (period: string, bankBalance: string, clearedLineIds: string[]) => runAs(fsPeople().bookkeeper, () => saveReconAction({ bankAccountId: bankId, period, bankBalance, clearedLineIds, bankItems: [] }));
    expect((await save("2027-01", "5,500.00", jan.open.map((l) => l.id))).ok).toBe(true);
    expect(await save("2026-12", "5,500.00", [])).toEqual({ ok: false, error: "LBP current is already reconciled for 2027-01; reconcile the months in order" });
  });

  it("a month not over can't be reconciled", async () => {
    const { bankId } = await bankFixture();
    expect(await runAs(fsPeople().bookkeeper, () => saveReconAction({ bankAccountId: bankId, period: "2026-12", bankBalance: "0", clearedLineIds: [], bankItems: [] }))).toEqual({ ok: false, error: "2026-12 isn't over yet" });
  });
});

describe("T14.5 the month-close checklist, lock and reopen, the year-end close", () => {
  const failing = async (year: number, month: number) => (await monthChecklist(year, month)).filter((i) => !i.ok).map((i) => i.key);
  const close = (year: number, month: number) => runAs(fsPeople().bookkeeper, () => closeMonthAction({ year, month }));

  it("an empty month passes; a month not over, or already closed, can't be closed; months needn't close in order", async () => {
    expect(await failing(2026, 3)).toEqual([]);
    expect((await monthChecklist(2026, 3)).map((i) => i.key)).toEqual(["teller_sessions", "pos_shifts", "water_billing", "draft_jvs", "daily_jobs", "depreciation", "savings_interest", "bank_recon"]);
    expect(await close(2026, 12)).toEqual({ ok: false, error: "2026-12 isn't over yet; close it from Jan 01, 2027" });
    expect((await close(2026, 5)).ok).toBe(true);
    expect(await close(2026, 5)).toEqual({ ok: false, error: "2026-05 is already closed" });
    const kept = await getDb().select().from(closeChecklists).where(eq(closeChecklists.period, "2026-05"));
    expect(kept).toHaveLength(8);
    expect(kept.every((k) => k.status === "PASS")).toBe(true);
    await expect(runAs(fsPeople().teller, () => closeMonthAction({ year: 2026, month: 4 }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("each item fails on its own: POS shifts, water billing, draft JVs, daily jobs, depreciation, savings interest, bank reconciliation", async () => {
    await postFixture();
    on("2027-01-05");
    // Daily jobs are due from the first posting (Dec 15).
    expect(await failing(2026, 12)).toEqual(["daily_jobs"]);
    expect((await monthChecklist(2026, 12)).find((i) => i.key === "daily_jobs")?.detail).toMatch(/on 17 date\(s\) from Dec 15, 2026/);
    await runJobsThrough("2026-12-15", "2026-12-31");
    expect(await failing(2026, 12)).toEqual([]);
    // A POS shift left open; a draft JV; a zone in reading; an asset not depreciated; a savings account; a bank account.
    const clerk = (await makeUser("STORE_CLERK", "clerk14")).id;
    await getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-12-20", openingFund: 0n });
    await getDb().insert(journalEntries).values({ book: "GJ", entryDate: "2026-12-28", particulars: "Draft", status: "DRAFT", sourceModule: "manual_jv", preparedBy: fsPeople().bookkeeper });
    const [zone] = await getDb().select().from(waterZones).limit(1);
    await getDb().insert(waterBillingPeriods).values({ period: "2026-12", zoneId: zone!.id, readingFrom: "2026-12-01", readingTo: "2026-12-05", billDate: "2026-12-06", dueDate: "2026-12-20", status: "READING" });
    await withTx((tx) => registerAsset(tx, { tag: "C1", description: "Chair", classCode: "FURNITURE", acquisitionDate: "2026-12-01", cost: P(600), salvage: 0n, lifeMonths: 60 }, fsPeople().bookkeeper));
    // A bank account set up in December.
    on("2026-12-20");
    const bankGl = await accountIdFor("cash_in_bank");
    await runAs(fsPeople().bookkeeper, () => createBankAccountAction({ name: "LBP", bankName: "Land Bank", accountNo: "1", glAccountId: bankGl }));
    on("2027-01-05");
    const memberId = (await getDb().select({ id: members.id }).from(members).limit(1))[0]!.id;
    const [sav] = await getDb().select().from(depositProducts).where(eq(depositProducts.kind, "SAVINGS")).limit(1);
    await getDb().insert(depositAccounts).values({ accountNo: "SA-TEST-1", memberId, productId: sav!.id, openedAt: "2026-12-15" });
    expect(await failing(2026, 12)).toEqual(["pos_shifts", "water_billing", "draft_jvs", "depreciation", "savings_interest", "bank_recon"]);
    const r = await close(2026, 12);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^2026-12 can't be closed yet: POS shifts closed and verified \(1 of 1 not closed and verified\); Water billing of the month posted/) });
  });

  it("a closed year's months can't be reopened; the year-end close needs every other month closed", async () => {
    await postFixture();
    on("2027-01-05");
    await runJobsThrough("2026-12-15", "2026-12-31");
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }))).toEqual({ ok: false, error: expect.stringMatching(/^Close these months first: 2026-01, 2026-02, .*2026-11$/) });
    for (let m = 1; m <= 11; m++) expect((await close(2026, m)).ok).toBe(true);
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }))).toEqual({ ok: true, data: { netSurplus: "₱19,400.00" } });
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }))).toEqual({ ok: false, error: "Fiscal year 2026 is already closed" });
    expect(await runAs(fsPeople().admin, () => reopenMonthAction({ year: 2026, month: 12, reason: "x" }))).toEqual({ ok: false, error: "Fiscal year 2026 is closed; its months can't be reopened" });
    const [closing] = await getDb().select().from(journalEntries).where(eq(journalEntries.sourceModule, "ledger.close"));
    expect(closing).toMatchObject({ entryDate: "2026-12-31", reference: "CLOSE-2026" });
    // Nobody reverses the closing entry from the Journal screen.
    expect(await runAs(fsPeople().manager, () => reverseJvAction({ jeId: closing!.id, reason: "x" }))).toMatchObject({ ok: false });
    // 2027 is open and starts from the closing balance sheet.
    expect((await yearPeriods(2027))?.months).toHaveLength(12);
    expect((await financialCondition("2027-01-31")).totals.assets).toBe(P(170400));
  });
});

describe("T14.6 mapping from the screen and the exports", () => {
  it("the bookkeeper maps an account to a line of the right statement and sets a revenue or expense account's segment", async () => {
    const [parent] = await getDb().select().from(accounts).where(eq(accounts.code, "53000"));
    const [acct] = await getDb().insert(accounts).values({ code: "53160", name: "Office Supplies", type: "EXPENSE", normalBalance: "DR", parentId: parent!.id, isPostable: true }).returning();
    const lines = await getDb().select().from(fsLines);
    const byCode = (c: string) => lines.find((l) => l.code === c)!.id;
    const { bookkeeper, teller } = fsPeople();
    await expect(runAs(teller, () => mapAccountAction({ accountId: acct!.id, fsLineId: byCode("OPERATING_EXPENSES") }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(bookkeeper, () => mapAccountAction({ accountId: acct!.id, fsLineId: byCode("CASH") }))).toEqual({ ok: false, error: "53160 Office Supplies belongs on the Statement of Operations" });
    expect(await runAs(bookkeeper, () => mapAccountAction({ accountId: acct!.id, fsLineId: byCode("NET_SURPLUS") }))).toEqual({ ok: false, error: "Choose a statement line" });
    expect((await runAs(bookkeeper, () => mapAccountAction({ accountId: acct!.id, fsLineId: byCode("COST_OF_SALES") }))).ok).toBe(true);
    expect((await runAs(bookkeeper, () => mapAccountAction({ accountId: acct!.id, fsLineId: byCode("OPERATING_EXPENSES") }))).ok).toBe(true);
    expect(await unmappedAccounts()).toEqual([]);
    expect((await runAs(bookkeeper, () => setSegmentAction({ accountId: acct!.id, segmentCode: "CONSUMER" }))).ok).toBe(true);
    const view = await mappingView();
    const ops = view.lines.find((l) => l.line.code === "OPERATING_EXPENSES")!;
    expect(ops.accounts.find((a) => a.code === "53160")).toMatchObject({ segment: "CONSUMER" });
    expect((await runAs(bookkeeper, () => setSegmentAction({ accountId: acct!.id, segmentCode: "GENERAL" }))).ok).toBe(true);
    expect((await mappingView()).lines.find((l) => l.line.code === "OPERATING_EXPENSES")!.accounts.find((a) => a.code === "53160")?.segment).toBeNull();
    const cash = await accountIdFor("cash_on_hand");
    expect(await runAs(bookkeeper, () => setSegmentAction({ accountId: cash, segmentCode: "CREDIT" }))).toEqual({ ok: false, error: "Only revenue and expense accounts have a segment" });
  });

  it("the workbook has a sheet per statement", async () => {
    await postFixture();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await fsWorkbook({ from: "2026-01-01", to: "2026-12-31" }, "PCMPC")) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Financial Condition", "Operations", "Changes in Equity", "Cash Flows"]);
    const last = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      return ws.getRow(ws.rowCount).values as unknown[];
    };
    expect(last("Cash Flows").slice(1, 3)).toEqual(["Cash at the end", 82400]);
    expect(last("Changes in Equity").slice(1, 3)).toEqual(["Total equity", 0]);
  });
});

describe("T14.2 property and equipment, and a closed year, in the statements", () => {
  const amt = (st: { lines: Array<{ code: string; amount: bigint }> }, code: string) => st.lines.find((l) => l.code === code)?.amount;

  it("equipment at cost less accumulated depreciation; the depreciation added back to operations, the purchase under investing", async () => {
    await postFixture();
    const [ppe, cash] = [await accountIdFor("property_equipment_OFFICE_EQUIPMENT"), await accountIdFor("cash_on_hand")];
    await withTx((tx) => postJournal(tx, { date: "2026-12-01", book: "GJ", particulars: "Desktop computer", lines: [{ accountId: ppe, debit: P(36000) }, { accountId: cash, credit: P(36000) }] }, fsPeople().bookkeeper));
    await withTx((tx) => registerAsset(tx, { tag: "EQ-1", description: "Desktop computer", classCode: "OFFICE_EQUIPMENT", acquisitionDate: "2026-12-01", cost: P(36000), salvage: 0n, lifeMonths: 36 }, fsPeople().bookkeeper));
    expect((await runAs(fsPeople().bookkeeper, () => runDepreciationAction({ period: "2026-12" }))).ok).toBe(true);
    const sfc = await financialCondition("2026-12-31");
    expect([amt(sfc, "PPE"), amt(sfc, "PPE_DEPRECIATION"), amt(sfc, "CASH"), amt(sfc, "NET_SURPLUS")]).toEqual([P(36000), -P(1000), P(46400), P(18400)]);
    expect(sfc.totals).toEqual({ assets: P(169400), liabilities: P(51000), equity: P(118400), liabilitiesAndEquity: P(169400), balanced: true });
    const cf = await cashFlows("2026-01-01", "2026-12-31");
    expect(cf.lines.find((l) => l.code === "PPE_DEPRECIATION")).toMatchObject({ activity: "OPERATING", amount: P(1000) });
    expect(cf.lines.find((l) => l.code === "PPE")).toMatchObject({ activity: "INVESTING", amount: -P(36000) });
    // 18,400 + 1,000 − 80,000 − 8,000 + 51,000 = −17,600.
    expect(cf.totals).toEqual({ operating: -P(17600), investing: -P(36000), financing: P(100000), netChange: P(46400), beginningCash: 0n, endingCash: P(46400) });
  });

  it("after the year-end close: the transfers in changes in equity; a net loss closes into Undivided Net Surplus as a debit", async () => {
    const [salaries, cash] = [await accountIdFor("salaries_wages"), await accountIdFor("cash_on_hand")];
    await withTx((tx) => postJournal(tx, { date: "2026-12-15", book: "GJ", particulars: "Salaries", lines: [{ accountId: salaries, debit: P(5000) }, { accountId: cash, credit: P(5000) }] }, fsPeople().bookkeeper));
    on("2027-01-05");
    await runJobsThrough("2026-12-15", "2026-12-31");
    for (let m = 1; m <= 11; m++) expect((await runAs(fsPeople().bookkeeper, () => closeMonthAction({ year: 2026, month: m }))).ok).toBe(true);
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }))).toEqual({ ok: true, data: { netSurplus: "-₱5,000.00" } });
    const sce = await changesInEquity("2026-01-01", "2026-12-31");
    expect(sce.rows.filter((r) => r.code === "UNS" || r.code === "NET_SURPLUS").map((r) => [r.code, r.opening, r.netSurplus, r.transfers, r.other, r.closing])).toEqual([
      ["UNS", 0n, 0n, -P(5000), 0n, -P(5000)],
      ["NET_SURPLUS", 0n, -P(5000), P(5000), 0n, 0n],
    ]);
    expect(amt(await financialCondition("2026-12-31"), "UNS")).toBe(-P(5000));
    expect((await trialBalance("2026-12-31")).rows.find((r) => r.name === "Undivided Net Surplus")).toMatchObject({ debit: P(5000), credit: 0n });
    expect((await operations("2026-01-01", "2026-12-31")).totals.netSurplus).toBe(-P(5000));
  });
});

describe("T14.3 assets from the books before, late registrations and voids", () => {
  const register = (o: Partial<Parameters<typeof registerAssetAction>[0]> = {}) =>
    runAs(fsPeople().bookkeeper, () => registerAssetAction({ tag: "OLD-1", description: "Photocopier", classCode: "OFFICE_EQUIPMENT", acquisitionDate: "2024-01-15", cost: "36,000.00", salvage: "0.00", lifeMonths: 36, ...o }));
  const run = (period: string) => runAs(fsPeople().bookkeeper, () => runDepreciationAction({ period }));

  it("an asset depreciated in the books before comes in with its accumulated depreciation and ends exactly at its salvage value", async () => {
    expect(await register()).toEqual({ ok: false, error: "The books start in 2026-01: enter the accumulated depreciation through 2025-12" });
    expect(await register({ openingAccumulated: "33,000.00" })).toEqual({ ok: false, error: "Enter the month the accumulated depreciation brought forward runs through" });
    expect(await register({ openingAccumulated: "33,000.00", depreciatedThrough: "2023-12" })).toEqual({ ok: false, error: "The accumulated depreciation runs through a month from the acquisition month up to this month" });
    expect(await register({ openingAccumulated: "36,000.01", depreciatedThrough: "2026-09" })).toEqual({ ok: false, error: "The accumulated depreciation brought forward is 0 up to the cost less the salvage value" });
    const old = await register({ openingAccumulated: "33,000.00", depreciatedThrough: "2026-09" });
    if (!old.ok) throw new Error(old.error);
    expect((await getDb().select().from(fixedAssets).where(eq(fixedAssets.id, old.data.id)))[0]).toMatchObject({ openingAccumulated: P(33000), accumulated: P(33000), depreciateFrom: "2026-10", status: "ACTIVE" });
    // Nothing was due before October, so those months close without a run.
    expect((await monthChecklist(2026, 9)).find((i) => i.key === "depreciation")).toMatchObject({ ok: true, detail: "No assets to depreciate" });
    expect(await run("2026-11")).toEqual({ ok: false, error: "Run the depreciation for 2026-10 first" });
    // Months 34, 35 and 36 of its life: ₱1,000.00 each, the last one what is left.
    for (const p of ["2026-10", "2026-11", "2026-12"]) expect(await run(p)).toEqual({ ok: true, data: { total: "₱1,000.00", assets: 1 } });
    expect((await getDb().select().from(fixedAssets).where(eq(fixedAssets.id, old.data.id)))[0]).toMatchObject({ accumulated: P(36000), status: "FULLY_DEPRECIATED" });
    // One already fully depreciated comes in done.
    const done = await register({ tag: "OLD-2", openingAccumulated: "36,000.00", depreciatedThrough: "2026-12" });
    if (!done.ok) throw new Error(done.error);
    expect((await getDb().select().from(fixedAssets).where(eq(fixedAssets.id, done.data.id)))[0]).toMatchObject({ status: "FULLY_DEPRECIATED", depreciateFrom: "2027-01" });
  });

  it("months already run aren't caught up: a late asset brings its depreciation forward; runs don't go back", async () => {
    const first = await register({ tag: "PC-1", acquisitionDate: "2026-10-01" });
    if (!first.ok) throw new Error(first.error);
    expect((await run("2026-10")).ok).toBe(true);
    expect(await register({ tag: "PC-2", acquisitionDate: "2026-10-20" })).toEqual({ ok: false, error: "Depreciation is already run through 2026-10: enter the accumulated depreciation through 2026-10" });
    const late = await register({ tag: "PC-2", acquisitionDate: "2026-10-20", openingAccumulated: "1,000.00", depreciatedThrough: "2026-10" });
    if (!late.ok) throw new Error(late.error);
    expect(await run("2026-11")).toEqual({ ok: true, data: { total: "₱2,000.00", assets: 2 } });
    expect(await run("2026-09")).toEqual({ ok: false, error: "Depreciation is already run through 2026-11" });
  });

  it("a wrongly registered asset is voided before its first depreciation; its tag is free again", async () => {
    const wrong = await register({ tag: "PC-9", acquisitionDate: "2026-11-03", cost: "3,600.00" });
    if (!wrong.ok) throw new Error(wrong.error);
    await expect(runAs(fsPeople().teller, () => voidAssetAction({ assetId: wrong.data.id, reason: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(fsPeople().bookkeeper, () => voidAssetAction({ assetId: wrong.data.id, reason: " " }))).toEqual({ ok: false, error: "Enter why the asset is voided" });
    expect(await runAs(fsPeople().bookkeeper, () => voidAssetAction({ assetId: wrong.data.id, reason: "Wrong cost" }))).toEqual({ ok: true, data: null });
    expect(await runAs(fsPeople().bookkeeper, () => voidAssetAction({ assetId: wrong.data.id, reason: "Again" }))).toEqual({ ok: false, error: "PC-9 is already voided" });
    const [audited] = await getDb().select().from(auditLog).where(eq(auditLog.action, "fa.void"));
    expect(audited?.after).toMatchObject({ status: "VOID", reason: "Wrong cost" });
    const right = await register({ tag: "PC-9", acquisitionDate: "2026-11-03" });
    if (!right.ok) throw new Error(right.error);
    // The voided asset isn't depreciated.
    expect(await run("2026-11")).toEqual({ ok: true, data: { total: "₱1,000.00", assets: 1 } });
    expect(await runAs(fsPeople().bookkeeper, () => voidAssetAction({ assetId: right.data.id, reason: "Typo" }))).toEqual({ ok: false, error: "PC-9 already has depreciation posted; it can't be voided" });
    await expect(getPool().query("UPDATE fixed_assets SET status = 'VOID', void_reason = 'x' WHERE id = $1", [right.data.id])).rejects.toThrow(/no depreciation posted/);
    await expect(getPool().query("UPDATE fixed_assets SET description = 'x' WHERE id = $1", [wrong.data.id])).rejects.toThrow(/voided fixed asset/);
    await expect(getPool().query("UPDATE fixed_assets SET depreciate_from = '2026-12' WHERE id = $1", [right.data.id])).rejects.toThrow(/don't change/);
  });
});

describe("T14.5 the next fiscal year, missed daily jobs, a failing last month, reopening", () => {
  const close = (year: number, month: number) => runAs(fsPeople().bookkeeper, () => closeMonthAction({ year, month }));

  it("the next fiscal year opens with its first entry, not with the old year's close; the year-end close needs the year before closed", async () => {
    const [cash, fees] = [await accountIdFor("cash_on_hand"), await accountIdFor("service_fee_income")];
    const post = (date: string) => withTx((tx) => postJournal(tx, { date, book: "GJ", particulars: "Fee", lines: [{ accountId: cash, debit: P(10) }, { accountId: fees, credit: P(10) }] }, fsPeople().bookkeeper));
    expect(await yearPeriods(2027)).toBeNull();
    // Not before the new year has started.
    await expect(post("2027-01-04")).rejects.toThrow("Period 2027-01 is not set up");
    on("2027-01-04");
    await post("2027-01-04");
    const fy27 = await yearPeriods(2027);
    expect(fy27?.months).toHaveLength(12);
    expect(fy27?.months.every((m) => m.status === "OPEN")).toBe(true);
    expect((await yearPeriods(2026))?.fy.status).toBe("OPEN");
    // Only the year right after the latest one, once it has started.
    await expect(post("2028-01-04")).rejects.toThrow("Period 2028-01 is not set up");
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2027 }))).toEqual({ ok: false, error: "Close fiscal year 2026 first" });
  });

  it("the missed daily jobs of a month run from the Period close screen (past dates only)", async () => {
    await postFixture();
    on("2027-01-05");
    expect((await monthChecklist(2026, 12)).find((i) => i.key === "daily_jobs")).toMatchObject({ ok: false });
    await expect(runAs(fsPeople().teller, () => runMissedJobsAction({ year: 2026, month: 12 }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(fsPeople().bookkeeper, () => runMissedJobsAction({ year: 2026, month: 12 }))).toEqual({ ok: true, data: { dates: 17 } });
    expect((await monthChecklist(2026, 12)).find((i) => i.key === "daily_jobs")).toMatchObject({ ok: true });
    expect(await runAs(fsPeople().bookkeeper, () => runMissedJobsAction({ year: 2026, month: 12 }))).toEqual({ ok: false, error: "No daily job is missing in 2026-12" });
    // January 1–4; today's jobs are the cron's.
    expect(await runAs(fsPeople().bookkeeper, () => runMissedJobsAction({ year: 2027, month: 1 }))).toEqual({ ok: true, data: { dates: 4 } });
  });

  it("the year-end close waits for the last month's checklist; a reopened month closes again with a new checklist", async () => {
    await postFixture();
    on("2027-01-05");
    for (let m = 1; m <= 11; m++) expect((await close(2026, m)).ok).toBe(true);
    expect(await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }))).toMatchObject({ ok: false, error: expect.stringMatching(/^2026-12 can't be closed yet: Daily jobs ran for every business date \(Missing: /) });
    expect(await runAs(fsPeople().admin, () => reopenMonthAction({ year: 2026, month: 5, reason: "Late bill from a supplier" }))).toEqual({ ok: true, data: null });
    expect((await close(2026, 5)).ok).toBe(true);
    expect(await getDb().select().from(closeChecklists).where(eq(closeChecklists.period, "2026-05"))).toHaveLength(16);
  });
});

describe("T14.6 a line takes its own kind of account", () => {
  it("an expense can't sit on a revenue line, nor an asset on a liability line; a receivable may reduce an equity line", async () => {
    const lines = await getDb().select().from(fsLines);
    const byCode = (c: string) => lines.find((l) => l.code === c)!.id;
    const map = (accountId: string, line: string) => runAs(fsPeople().bookkeeper, () => mapAccountAction({ accountId, fsLineId: byCode(line) }));
    expect(await map(await accountIdFor("salaries_wages"), "SALES")).toEqual({ ok: false, error: "53210 Salaries and Wages is an expense account; put it on a line under Expenses" });
    expect(await map(await accountIdFor("cash_on_hand"), "DEPOSITS")).toEqual({ ok: false, error: "11110 Cash on Hand is an asset account; put it on a line under Assets" });
    expect((await map(await accountIdFor("subscription_receivable_common"), "SHARE_CAPITAL")).ok).toBe(true);
  });
});
