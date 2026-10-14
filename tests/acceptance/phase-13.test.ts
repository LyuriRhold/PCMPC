import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import { journalLines } from "@/modules/ledger/schema";
import { subsidiaryLedger } from "@/modules/ledger/service";
import { returnSaleAction, voidSaleAction } from "@/modules/store/pos-actions";
import { getSale, shiftReading, storePatronage } from "@/modules/store/pos";
import { stockBalance } from "@/modules/store/service";
import { acct, P } from "../helpers/phase03";
import { openSessionAs } from "../helpers/phase04";
import { product, receive } from "../helpers/phase12";
import { member, openShift, posFixture, sell, setupPos, storePeople, supervisor } from "../helpers/phase13";

afterEach(() => setClock(null));

/** An entry's debit and credit per DOMAIN §6 mapping key, with the member tag. */
async function linesOf(jeId: string) {
  const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, jeId));
  const keys = ["cash_on_hand", "accounts_receivable_members", "sales", "sales_returns", "cost_of_sales", "merchandise_inventory"];
  const out: Record<string, { debit: bigint; credit: bigint }> = {};
  for (const k of keys) {
    const id = await acct(k);
    const ls = lines.filter((l) => l.accountId === id);
    if (ls.length) out[k] = { debit: ls.reduce((s, l) => s + l.debit, 0n), credit: ls.reduce((s, l) => s + l.credit, 0n) };
  }
  return out;
}

const arOf = async (memberId: string) => (await subsidiaryLedger("accounts_receivable_members", memberId, "2026-01-01", "2026-12-31")).closing;

describe("Phase 13 acceptance (P1 sells at ₱70.00, average cost ₱55.00, stock 15)", () => {
  beforeEach(async () => {
    await setupPos();
    await openShift("1,000.00");
  });

  it("A13.1 cash sale 5 × P1, tendered ₱500.00 → total ₱350.00, change ₱150.00; Dr Cash 350 / Cr Sales 350; Dr COGS 275 / Cr Inventory 275; stock 10", async () => {
    const { p1 } = posFixture();
    const r = await sell({ lines: [[p1, 5]], tendered: "500.00" });
    if (!r.ok) throw new Error(r.error);
    const { sale } = (await getSale(r.data.id))!;
    expect(sale).toMatchObject({ status: "COMPLETED", payment: "CASH", total: P(350), tendered: P(500), change: P(150) });
    expect(await linesOf(sale.jeId!)).toEqual({
      cash_on_hand: { debit: P(350), credit: 0n },
      sales: { debit: 0n, credit: P(350) },
      cost_of_sales: { debit: P(275), credit: 0n },
      merchandise_inventory: { debit: 0n, credit: P(275) },
    });
    expect((await stockBalance(p1)).qty).toBe(10);
  });

  it("A13.2 charge sale ₱350.00 for M-000001 with limit ₱1,000.00 → AR–Members M-000001 = ₱350.00", async () => {
    const m = await member();
    expect(m.memberNo).toBe("M-000001");
    const r = await sell({ lines: [[posFixture().p1, 5]], payment: "CHARGE", memberId: m.id });
    if (!r.ok) throw new Error(r.error);
    expect(await arOf(m.id)).toBe(P(350));
  });

  it('A13.3 M-000001 has AR ₱900.00, tries to charge ₱350.00 → "Exceeds credit limit (available ₱100.00)"', async () => {
    const m = await member();
    const p2 = await product({ sku: "P2", name: "Rice 5 kg", price: "450.00" });
    await receive(posFixture().s1, [[p2, 2, "400.00"]]);
    const first = await sell({ lines: [[p2, 2]], payment: "CHARGE", memberId: m.id });
    if (!first.ok) throw new Error(first.error);
    expect(await arOf(m.id)).toBe(P(900));
    expect(await sell({ lines: [[posFixture().p1, 5]], payment: "CHARGE", memberId: m.id })).toEqual({ ok: false, error: "Exceeds credit limit (available ₱100.00)" });
  });

  it("A13.4 a non-member charge is rejected", async () => {
    const r = await sell({ lines: [[posFixture().p1, 1]], payment: "CHARGE", memberId: null });
    expect(r).toMatchObject({ ok: false });
    expect((await stockBalance(posFixture().p1)).qty).toBe(15);
  });

  it("A13.5 return 1 × P1 from A13.1 (cash refund) → Dr Sales Returns 70 / Cr Cash 70; Dr Inventory 55 / Cr COGS 55; stock +1", async () => {
    const { p1 } = posFixture();
    const s = await sell({ lines: [[p1, 5]], tendered: "500.00" });
    if (!s.ok) throw new Error(s.error);
    const line = (await getSale(s.data.id))!.lines[0]!;
    const r = await runAs(storePeople().clerk, () => returnSaleAction({ saleId: s.data.id, lines: [{ saleLineId: line.id, qty: 1 }], refundMode: "CASH", reason: "Dented can" }));
    if (!r.ok) throw new Error(r.error);
    expect(await linesOf(r.data.jeId)).toEqual({
      sales_returns: { debit: P(70), credit: 0n },
      cash_on_hand: { debit: 0n, credit: P(70) },
      merchandise_inventory: { debit: P(55), credit: 0n },
      cost_of_sales: { debit: 0n, credit: P(55) },
    });
    expect((await stockBalance(p1)).qty).toBe(11);
  });

  it("A13.6 Z-reading for a shift: opening ₱1,000.00, A13.1, A13.5 → net cash sales ₱280.00; expected cash ₱1,280.00", async () => {
    const { p1 } = posFixture();
    const s = await sell({ lines: [[p1, 5]], tendered: "500.00" });
    if (!s.ok) throw new Error(s.error);
    const { sale, lines } = (await getSale(s.data.id))!;
    const r = await runAs(storePeople().clerk, () => returnSaleAction({ saleId: sale.id, lines: [{ saleLineId: lines[0]!.id, qty: 1 }], refundMode: "CASH", reason: "Dented can" }));
    if (!r.ok) throw new Error(r.error);
    const z = await shiftReading(sale.shiftId);
    expect(z).toMatchObject({ openingFund: P(1000), grossSales: P(350), returns: P(70), netSales: P(280), cashSales: P(350), cashRefunds: P(70), netCashSales: P(280), expectedCash: P(1280) });
  });

  it("A13.7 member store patronage 2026 after A13.2 + a cash sale of ₱140.00 to the same member − a return of ₱70.00 → ₱420.00", async () => {
    const { p1 } = posFixture();
    const m = await member();
    const charge = await sell({ lines: [[p1, 5]], payment: "CHARGE", memberId: m.id });
    const cash = await sell({ lines: [[p1, 2]], memberId: m.id, tendered: "140.00" });
    if (!charge.ok || !cash.ok) throw new Error("sales failed");
    const line = (await getSale(cash.data.id))!.lines[0]!;
    const r = await runAs(storePeople().clerk, () => returnSaleAction({ saleId: cash.data.id, lines: [{ saleLineId: line.id, qty: 1 }], refundMode: "CASH", reason: "Wrong item" }));
    if (!r.ok) throw new Error(r.error);
    expect(await storePatronage(m.id, 2026)).toBe(P(420));
  });

  it("A13.8 a void without a supervisor's credential is rejected; with it → VOIDED, no entry", async () => {
    const { p1 } = posFixture();
    const lines = [{ productId: p1, qty: 2 }];
    const clerk = storePeople().clerk;
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "Customer left", supervisor: null }))).toMatchObject({ ok: false });
    expect(await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "Customer left", supervisor: { username: "mgr1", password: "wrong-password" } }))).toMatchObject({ ok: false });
    const v = await runAs(clerk, () => voidSaleAction({ memberId: null, lines, reason: "Customer left", supervisor: supervisor() }));
    if (!v.ok) throw new Error(v.error);
    const { sale } = (await getSale(v.data.id))!;
    expect(sale).toMatchObject({ status: "VOIDED", jeId: null });
    expect((await stockBalance(p1)).qty).toBe(15);
  });

  it("A13.9 teller receipt STORE_AR_PAYMENT ₱350.00 for M-000001 → AR–Members M-000001 = ₱0.00", async () => {
    const m = await member();
    expect(m.memberNo).toBe("M-000001");
    const s = await sell({ lines: [[posFixture().p1, 5]], payment: "CHARGE", memberId: m.id });
    if (!s.ok) throw new Error(s.error);
    const { teller } = storePeople();
    await openSessionAs(teller);
    const r = await runAs(teller, () =>
      issueReceiptAction({ payor: { type: "MEMBER", id: m.id, name: "" }, mode: "CASH", checkNo: null, birReceiptNo: "BIR-1301", items: [{ type: "STORE_AR_PAYMENT", refId: m.id, amount: "350.00", description: null }] }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(await arOf(m.id)).toBe(0n);
  });
});
