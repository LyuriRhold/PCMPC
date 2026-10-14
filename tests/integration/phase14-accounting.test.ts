import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { accountSegments, assetClasses, fsLineAccounts, fsLines } from "@/modules/accounting/schema";
import { seedFs } from "@/modules/accounting/seed";
import { cashFlows, changesInEquity, financialCondition, operations, unmappedAccounts } from "@/modules/accounting/statements";
import { accounts } from "@/modules/ledger/schema";
import { P } from "../helpers/phase03";
import { fsPeople, postFixture, setupFs } from "../helpers/phase14";

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
