import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { changeMemberStatusAction } from "@/modules/members/actions";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, subsidiaryLedger, trialBalance } from "@/modules/ledger/service";
import { updateProductAction } from "@/modules/store/actions";
import { findMembersAction, findProductAction, openShiftAction, returnSaleAction, voidSaleAction } from "@/modules/store/pos-actions";
import { getSale } from "@/modules/store/pos";
import { posShifts, sales, stockMoves } from "@/modules/store/schema";
import { stockBalance } from "@/modules/store/service";
import { P } from "../helpers/phase03";
import { product, receive } from "../helpers/phase12";
import { member, openShift, posFixture, sell, setupPos, storePeople, supervisor } from "../helpers/phase13";

beforeEach(async () => {
  await setupPos();
});
afterEach(() => setClock(null));

describe("T13.1 schema and data rules", () => {
  it("one open shift per cashier; a shift keeps its cashier, date and opening fund and closes once", async () => {
    const { clerk, manager } = storePeople();
    const [s] = await getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-07", openingFund: P(1000) }).returning();
    await expect(getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-07", openingFund: P(500) })).rejects.toThrow();
    const pool = getPool();
    await expect(pool.query("UPDATE pos_shifts SET opening_fund = 1 WHERE id = $1", [s!.id])).rejects.toThrow(/only the closing and verification are recorded/);
    await expect(pool.query("UPDATE pos_shifts SET status = 'VERIFIED' WHERE id = $1", [s!.id])).rejects.toThrow(/closed first/);
    await expect(pool.query("DELETE FROM pos_shifts WHERE id = $1", [s!.id])).rejects.toThrow(/can't be deleted/);
    await pool.query("UPDATE pos_shifts SET status = 'CLOSED', counted_cash = 100000, expected_cash = 100000, variance = 0 WHERE id = $1", [s!.id]);
    await expect(pool.query("UPDATE pos_shifts SET counted_cash = 5 WHERE id = $1", [s!.id])).rejects.toThrow(/CLOSED POS shift can't change/);
    await expect(pool.query("UPDATE pos_shifts SET status = 'VERIFIED', verified_by = cashier_id WHERE id = $1", [s!.id])).rejects.toThrow(/pos_shifts_sod_chk/);
    await pool.query("UPDATE pos_shifts SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [s!.id, manager]);
    // A new shift can open once the other is closed.
    await getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-08", openingFund: P(500) });
  });
});

describe("T13.2 sales", () => {
  it("a sale needs the cashier's open shift for today; one shift at a time", async () => {
    const { p1 } = posFixture();
    expect(await sell({ lines: [[p1, 1]], tendered: "70.00" })).toEqual({ ok: false, error: "Open your shift first" });
    await expect(runAs(storePeople().manager, () => openShiftAction({ openingFund: "500.00" }))).rejects.toBeInstanceOf(ForbiddenError);
    await openShift("1,000.00");
    expect(await runAs(storePeople().clerk, () => openShiftAction({ openingFund: "500.00" }))).toEqual({ ok: false, error: "Your shift is already open" });
    setClock(() => new Date("2026-10-08T01:00:00Z"));
    expect(await sell({ lines: [[p1, 1]], tendered: "70.00" })).toEqual({ ok: false, error: "Close your shift from an earlier day first" });
  });

  it("prices come from the item master; cash covers the total; stock never goes below zero; nothing is posted on an error", async () => {
    const { p1 } = posFixture();
    await openShift();
    expect(await sell({ lines: [[p1, 2]], tendered: "100.00" })).toEqual({ ok: false, error: "The amount tendered (₱100.00) is less than the total (₱140.00)" });
    expect(await sell({ lines: [[p1, 2]], tendered: null })).toEqual({ ok: false, error: "Enter the amount tendered" });
    expect(await sell({ lines: [[p1, 16]], tendered: "2,000.00" })).toEqual({ ok: false, error: "P1 Sardines 155 g: Insufficient stock (15)" });
    expect(await sell({ lines: [[p1, 0]], tendered: "1.00" })).toMatchObject({ ok: false, error: expect.stringMatching(/whole number from 1 to 100,000/) });
    expect(await getDb().select().from(sales)).toHaveLength(0);
    // The same product on two lines is fine; the second line takes the stock left by the first.
    const r = await sell({ lines: [[p1, 10], [p1, 5]], tendered: "1,050.00" });
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ saleNo: "S-2026-000001", total: "₱1,050.00", change: "₱0.00" });
    const sale = (await getSale(r.data.id))!;
    expect(sale.lines.map((l) => [l.qty, l.unitPrice, l.lineTotal, l.unitCost, l.cogs])).toEqual([
      [10, P(70), P(700), "55.0000", P(550)],
      [5, P(70), P(350), "55.0000", P(275)],
    ]);
    expect(await stockBalance(p1)).toEqual({ qty: 0, avgCost: "55.0000", value: 0n });
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, r.data.jeId));
    expect(je).toMatchObject({ book: "SJ", sourceModule: "store" });
    // An inactive product is no longer sold.
    await runAs(storePeople().manager, () => updateProductAction({ id: p1, sku: "P1", barcode: null, name: "Sardines 155 g", unit: "pc", categoryId: null, reorderLevel: 5, vatClass: "VAT_EXEMPT", isActive: false }));
    expect(await sell({ lines: [[p1, 1]], tendered: "70.00" })).toEqual({ ok: false, error: "P1 Sardines 155 g is no longer sold" });
  });

  it("a member's cash sale counts for the member; a charge goes to their AR (member-tagged) within the limit", async () => {
    const { p1 } = posFixture();
    await openShift();
    const m = await member();
    const cash = await sell({ lines: [[p1, 1]], memberId: m.id, tendered: "100.00" });
    if (!cash.ok) throw new Error(cash.error);
    expect((await getSale(cash.data.id))!.sale).toMatchObject({ customerType: "MEMBER", memberId: m.id, payment: "CASH", change: P(30) });
    const charge = await sell({ lines: [[p1, 2]], payment: "CHARGE", memberId: m.id });
    if (!charge.ok) throw new Error(charge.error);
    const ar = await accountIdFor("accounts_receivable_members");
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, charge.data.jeId));
    expect(lines.filter((l) => l.accountId === ar).map((l) => [l.debit, l.memberId])).toEqual([[P(140), m.id]]);
    expect((await subsidiaryLedger("accounts_receivable_members", m.id, "2026-01-01", "2026-12-31")).closing).toBe(P(140));
    // A member who isn't ACTIVE can't buy as a member.
    await runAs(storePeople().manager, () => changeMemberStatusAction({ memberId: m.id, to: "INACTIVE", reason: "No activity" }));
    expect(await sell({ lines: [[p1, 1]], payment: "CHARGE", memberId: m.id })).toMatchObject({ ok: false, error: expect.stringMatching(/is not an ACTIVE member/) });
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("voids need a supervisor (store.supervise) other than the cashier; a wrong password counts toward the lockout", async () => {
    const { p1 } = posFixture();
    const { clerk } = storePeople();
    await openShift();
    const lines = [{ productId: p1, qty: 3 }];
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "x", supervisor: null }))).toEqual({ ok: false, error: "A supervisor's username and password are needed to void a sale" });
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "x", supervisor: { username: "clerk1", password: "Correct-Horse-2026" } }))).toEqual({
      ok: false,
      error: "clerk1 can't approve this (store.supervise is required)",
    });
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "x", supervisor: { username: "mgr1", password: "nope" } }))).toEqual({ ok: false, error: "Invalid supervisor username or password" });
    const [mgr] = await getDb().select().from(users).where(eq(users.username, "mgr1"));
    expect(mgr?.failedAttempts).toBe(1);
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: " ", supervisor: supervisor() }))).toEqual({ ok: false, error: "Enter why the sale is voided" });
    const v = await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "Customer left", supervisor: supervisor() }));
    if (!v.ok) throw new Error(v.error);
    const sale = (await getSale(v.data.id))!;
    expect(sale.sale).toMatchObject({ saleNo: "S-2026-000001", status: "VOIDED", total: P(210), jeId: null, voidReason: "Customer left" });
    expect(sale.lines.map((l) => [l.qty, l.cogs])).toEqual([[3, 0n]]);
    expect(await getDb().select().from(stockMoves).where(eq(stockMoves.refId, v.data.id))).toHaveLength(0);
    // The next sale keeps the series gapless.
    const next = await sell({ lines: [[p1, 1]], tendered: "70.00" });
    expect(next).toMatchObject({ ok: true, data: { saleNo: "S-2026-000002" } });
    await expect(getPool().query("UPDATE sales SET total = 1 WHERE id = $1", [v.data.id])).rejects.toThrow(/immutable/);
  });

  it("the scanner finds a product by barcode or SKU; members are found by no. or name", async () => {
    const clerk = storePeople().clerk;
    const p2 = await product({ sku: "p-milk", name: "Milk 1 L" });
    await runAs(storePeople().manager, () => updateProductAction({ id: p2, sku: "P-MILK", barcode: "4800361400111", name: "Milk 1 L", unit: "box", categoryId: null, reorderLevel: 0, vatClass: "VAT_EXEMPT", isActive: true }));
    await receive(posFixture().s1, [[p2, 4, "80.00"]]);
    expect(await runAs(clerk, () => findProductAction({ code: "4800361400111" }))).toEqual({ ok: true, data: { id: p2, sku: "P-MILK", name: "Milk 1 L", unit: "box", price: "7000", onHand: 4 } });
    expect(await runAs(clerk, () => findProductAction({ code: "p-milk" }))).toMatchObject({ ok: true, data: { id: p2 } });
    expect(await runAs(clerk, () => findProductAction({ code: "000" }))).toEqual({ ok: false, error: 'No product with barcode or SKU "000"' });
    const m = await member("Dela Cruz");
    expect(await runAs(clerk, () => findMembersAction({ q: m.memberNo }))).toMatchObject({ ok: true, data: [{ id: m.id, memberNo: m.memberNo }] });
    expect(await runAs(clerk, () => findMembersAction({ q: "dela cruz" }))).toMatchObject({ ok: true, data: [{ id: m.id }] });
  });
});

describe("T13.3 returns", () => {
  const giveBack = (saleId: string, lines: Array<{ saleLineId: string; qty: number }>, refundMode: "CASH" | "AR" = "CASH") =>
    runAs(storePeople().clerk, () => returnSaleAction({ saleId, lines, refundMode, reason: "Returned" }));

  it("not more than was sold less earlier returns; the last units take what is left of the line's COGS", async () => {
    const { s1 } = posFixture();
    const p2 = await product({ sku: "P2", name: "Corned beef", price: "12.00" });
    await receive(s1, [[p2, 3, "10.00"]]);
    await receive(s1, [[p2, 4, "10.01"]]);
    await openShift();
    const s = await sell({ lines: [[p2, 7]], tendered: "84.00" });
    if (!s.ok) throw new Error(s.error);
    const line = (await getSale(s.data.id))!.lines[0]!;
    expect([line.unitCost, line.cogs]).toEqual(["10.0057", P(70, 4)]);
    expect(await giveBack(s.data.id, [{ saleLineId: line.id, qty: 8 }])).toEqual({ ok: false, error: "P2 Corned beef: only 7 of 7 can still be returned" });
    const first = await giveBack(s.data.id, [{ saleLineId: line.id, qty: 3 }]);
    if (!first.ok) throw new Error(first.error);
    expect(first.data.returnNo).toBe("SR-2026-000001");
    expect(await giveBack(s.data.id, [{ saleLineId: line.id, qty: 5 }])).toEqual({ ok: false, error: "P2 Corned beef: only 4 of 7 can still be returned" });
    const rest = await giveBack(s.data.id, [{ saleLineId: line.id, qty: 4 }]);
    if (!rest.ok) throw new Error(rest.error);
    const after = (await getSale(s.data.id))!;
    // 3 × 10.0057 = ₱30.02; the last 4 take the rest of ₱70.04: ₱40.02. Nothing drifts.
    expect(after.returns.map((r) => [r.total, r.cost])).toEqual([
      [P(36), P(30, 2)],
      [P(48), P(40, 2)],
    ]);
    expect(await stockBalance(p2)).toMatchObject({ qty: 7, value: P(70, 4) });
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("a charge sale can be credited back to the member's account; a cash sale can't", async () => {
    const { p1 } = posFixture();
    const m = await member();
    await openShift();
    const cash = await sell({ lines: [[p1, 1]], tendered: "70.00" });
    const charge = await sell({ lines: [[p1, 3]], payment: "CHARGE", memberId: m.id });
    if (!cash.ok || !charge.ok) throw new Error("sales failed");
    const cashLine = (await getSale(cash.data.id))!.lines[0]!;
    const chargeLine = (await getSale(charge.data.id))!.lines[0]!;
    expect(await giveBack(cash.data.id, [{ saleLineId: cashLine.id, qty: 1 }], "AR")).toEqual({ ok: false, error: "Only a charge sale is refunded to the member's account" });
    expect(await giveBack(cash.data.id, [{ saleLineId: chargeLine.id, qty: 1 }])).toEqual({ ok: false, error: expect.stringMatching(/isn't on S-2026-000001/) });
    const r = await giveBack(charge.data.id, [{ saleLineId: chargeLine.id, qty: 2 }], "AR");
    if (!r.ok) throw new Error(r.error);
    const ar = await accountIdFor("accounts_receivable_members");
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, r.data.jeId));
    expect(lines.filter((l) => l.accountId === ar).map((l) => [l.credit, l.memberId])).toEqual([[P(140), m.id]]);
    expect((await subsidiaryLedger("accounts_receivable_members", m.id, "2026-01-01", "2026-12-31")).closing).toBe(P(70));
    expect((await giveBack(charge.data.id, [{ saleLineId: chargeLine.id, qty: 1 }], "AR")).ok).toBe(true);
    expect((await subsidiaryLedger("accounts_receivable_members", m.id, "2026-01-01", "2026-12-31")).closing).toBe(0n);
  });

  it("a voided sale has nothing to return", async () => {
    const { p1 } = posFixture();
    await openShift();
    const v = await runAs(storePeople().clerk, () => voidSaleAction({ memberId: null, lines: [{ productId: p1, qty: 1 }], reason: "Customer left", supervisor: supervisor() }));
    if (!v.ok) throw new Error(v.error);
    const line = (await getSale(v.data.id))!.lines[0]!;
    expect(await giveBack(v.data.id, [{ saleLineId: line.id, qty: 1 }])).toEqual({ ok: false, error: "S-2026-000001 was voided; nothing to return" });
  });
});
