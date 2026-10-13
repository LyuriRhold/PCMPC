import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { businessToday, setClock } from "@/lib/dates";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountBalance } from "@/modules/ledger/service";
import { approveCountAction, createCountAction, enterCountAction, submitCountAction } from "@/modules/store/actions";
import { inventoryValuation } from "@/modules/store/reports";
import { getCount, stockBalance, supplierBalance } from "@/modules/store/service";
import { EMPTY_STOCK, issueStock, receiveStock } from "@/modules/store/stock";
import { acct, P } from "../helpers/phase03";
import { product, receive, setupStore, storePeople, supplier } from "../helpers/phase12";

afterEach(() => setClock(null));

/** Debits and credits of an entry per account, with the supplier tag. */
async function linesOf(jeId: string) {
  return getDb().select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit, supplierId: journalLines.supplierId }).from(journalLines).where(eq(journalLines.jeId, jeId));
}

/** A count by the store clerk: created, counted and submitted. */
async function submittedCount(counted: Array<[string, number]>) {
  const { clerk } = storePeople();
  const c = await runAs(clerk, () => createCountAction({ productIds: counted.map(([p]) => p), remarks: "October count" }));
  if (!c.ok) throw new Error(c.error);
  const e = await runAs(clerk, () => enterCountAction({ countId: c.data.id, lines: counted.map(([productId, countedQty]) => ({ productId, countedQty })) }));
  if (!e.ok) throw new Error(e.error);
  const s = await runAs(clerk, () => submitCountAction({ countId: c.data.id }));
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("Phase 12 acceptance: stock engine (moving average)", () => {
  it("A12.1 receive 10 @ ₱50.00, then 10 @ ₱60.00 → qty 20, avg ₱55.0000, value ₱1,100.00", () => {
    expect(receiveStock(receiveStock(EMPTY_STOCK, 10, P(500)), 10, P(600))).toEqual({ qty: 20, avgCost: "55.0000", value: P(1100) });
  });

  it("A12.2 issue 5 → COGS ₱275.00; remaining 15 @ 55, value ₱825.00", () => {
    expect(issueStock({ qty: 20, avgCost: "55.0000", value: P(1100) }, 5)).toEqual({ cogs: P(275), balance: { qty: 15, avgCost: "55.0000", value: P(825) } });
  });

  it("A12.3 receive 3 @ ₱10.00, then 4 @ ₱10.01, then issue all 7 → avg 10.0057; COGS ₱70.04 exactly; value 0", () => {
    const b = receiveStock(receiveStock(EMPTY_STOCK, 3, P(30)), 4, 4n * P(10, 1));
    expect(b.avgCost).toBe("10.0057");
    const out = issueStock(b, 7);
    expect(out.cogs).toBe(P(70, 4));
    expect(out.balance).toMatchObject({ qty: 0, value: 0n });
  });

  it('A12.4 qty 15, issue 16 → rejected "Insufficient stock (15)"', () => {
    expect(() => issueStock({ qty: 15, avgCost: "55.0000", value: P(825) }, 16)).toThrow("Insufficient stock (15)");
  });
});

describe("Phase 12 acceptance: receiving, counts and valuation (2026-10-07)", () => {
  beforeEach(async () => {
    await setupStore();
  });

  it("A12.1 through receiving reports: 10 @ ₱50.00 then 10 @ ₱60.00 → the stock balance is 20 @ 55.0000, ₱1,100.00", async () => {
    const s1 = await supplier();
    const p1 = await product({ sku: "P1" });
    await receive(s1, [[p1, 10, "50.00"]]);
    await receive(s1, [[p1, 10, "60.00"]]);
    expect(await stockBalance(p1)).toMatchObject({ qty: 20, avgCost: "55.0000", value: P(1100) });
  });

  it("A12.5 RR ₱1,100.00 on account from S1 → Dr Merchandise Inventory 1,100.00 / Cr AP–Trade 1,100.00 (S1); AP S1 = ₱1,100.00", async () => {
    const s1 = await supplier();
    const p1 = await product({ sku: "P1" });
    const rr = await receive(s1, [[p1, 20, "55.00"]]);
    const [inv, ap] = [await acct("merchandise_inventory"), await acct("accounts_payable_trade")];
    const lines = await linesOf(rr.jeId);
    expect(lines.filter((l) => l.accountId === inv)).toEqual([{ accountId: inv, debit: P(1100), credit: 0n, supplierId: null }]);
    expect(lines.filter((l) => l.accountId === ap)).toEqual([{ accountId: ap, debit: 0n, credit: P(1100), supplierId: s1 }]);
    expect(lines).toHaveLength(2);
    expect(await supplierBalance(s1)).toBe(P(1100));
  });

  it("A12.6 count 13 vs system 15 at avg 55 → variance −2, ₱110.00; no GL until approved; the preparer → Forbidden; the manager → Dr Inventory Losses / Cr Inventory 110.00", async () => {
    const s1 = await supplier();
    const p1 = await product({ sku: "P1" });
    await receive(s1, [[p1, 15, "55.00"]]);
    const countId = await submittedCount([[p1, 13]]);
    const sheet = (await getCount(countId))!;
    expect(sheet.lines).toEqual([expect.objectContaining({ productId: p1, systemQty: 15, countedQty: 13, variance: -2, varianceValue: -P(110) })]);
    expect(await getDb().select().from(journalEntries).where(and(eq(journalEntries.sourceModule, "store"), eq(journalEntries.sourceId, countId)))).toHaveLength(0);

    await expect(runAs(storePeople().clerk, () => approveCountAction({ countId }))).rejects.toBeInstanceOf(ForbiddenError);
    const approved = await runAs(storePeople().manager, () => approveCountAction({ countId }));
    if (!approved.ok) throw new Error(approved.error);
    const [losses, inv] = [await acct("inventory_losses"), await acct("merchandise_inventory")];
    const lines = await linesOf(approved.data.jeId!);
    expect(lines.filter((l) => l.accountId === losses).map((l) => [l.debit, l.credit])).toEqual([[P(110), 0n]]);
    expect(lines.filter((l) => l.accountId === inv).map((l) => [l.debit, l.credit])).toEqual([[0n, P(110)]]);
    expect(lines).toHaveLength(2);
    expect(await stockBalance(p1)).toMatchObject({ qty: 13, value: P(715) });
  });

  it("A12.7 after the fixture, the valuation report total = the GL Merchandise Inventory balance", async () => {
    const s1 = await supplier();
    const p1 = await product({ sku: "P1" });
    const p2 = await product({ sku: "P2" });
    await receive(s1, [[p1, 10, "50.00"]]);
    await receive(s1, [[p1, 10, "60.00"]]);
    await receive(s1, [[p2, 3, "10.00"]], "CASH");
    await receive(s1, [[p2, 4, "10.01"]]);
    // P1: 18 counted vs 20 (−2 @ 55 = ₱110.00); P2: 8 counted vs 7 (+1 @ 10.0057 = ₱10.01).
    const countId = await submittedCount([
      [p1, 18],
      [p2, 8],
    ]);
    const approved = await runAs(storePeople().manager, () => approveCountAction({ countId }));
    if (!approved.ok) throw new Error(approved.error);

    const report = await inventoryValuation();
    const gl = await accountBalance(await acct("merchandise_inventory"), businessToday());
    expect(report.total).toBe(gl.net);
    expect(report.total).toBe(P(1100) - P(110) + P(70, 4) + P(10, 1));
    expect(report.glBalance).toBe(gl.net);
  });
});
