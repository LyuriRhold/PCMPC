import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { GET as cronDaily } from "@/app/api/cron/daily/route";
import { getDb, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { runDailyJobs } from "@/lib/cron";
import { cancelReceiptAction, duesAction, issueReceiptAction } from "@/modules/cashiering/actions";
import { disbursementVouchers } from "@/modules/cashiering/schema";
import { journalLines } from "@/modules/ledger/schema";
import { approveAdjustment, prepareAdjustment } from "@/modules/water/billing";
import { closeAccountAction, openPeriodAction } from "@/modules/water/billing-actions";
import { addProductionReadingAction, cancelNoticeAction, disconnectAction, issueNoticeAction, reconnectAction } from "@/modules/water/collection-actions";
import { accountOutstanding, disconnectionList } from "@/modules/water/collections";
import { customerSoa, nrw, waterTiles } from "@/modules/water/reports";
import { waterBills, waterDepositSettlements, waterPaymentAllocations, waterPenalties } from "@/modules/water/schema";
import { acct, P } from "../helpers/phase03";
import { activeAccount } from "../helpers/phase06";
import { at, billMonth, payWater, setupCollections, tellerToday } from "../helpers/phase07";

let clerk = "";
let manager = "";
let zoneId = 0;
let routeId = "";
beforeEach(async () => {
  const u = await setupCollections();
  clerk = u.clerk.id;
  manager = u.manager.id;
  zoneId = u.zoneId;
  routeId = u.routeId;
  setClock(() => at("2026-09-01"));
});
afterEach(() => setClock(null));

const acc = (o: Partial<Parameters<typeof activeAccount>[0]> = {}) => activeAccount({ clerk, manager, routeId, initialReading: 0, ...o });
const billsOf = (accountId: string) => getDb().select().from(waterBills).where(eq(waterBills.accountId, accountId));
async function arFor(customerId: string) {
  const ar = await acct("ar_water");
  const lines = await getDb().select().from(journalLines).where(and(eq(journalLines.accountId, ar), eq(journalLines.customerId, customerId)));
  return lines.reduce((s, l) => s + l.debit - l.credit, 0n);
}

describe("T7.2 water bill payments", () => {
  it("dues list each account's unpaid total (with penalties); a payment's slip shows the balance after", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    setClock(() => at("2026-10-16"));
    await runDailyJobs("2026-10-16");
    const teller = await tellerToday();
    const dues = await runAs(teller, () => duesAction({ payor: { type: "WATER_CUSTOMER", id: a.customer.id, name: "" } }));
    expect(dues.ok && dues.data.filter((d) => d.type === "WATER_BILL")).toEqual([
      { type: "WATER_BILL", refId: a.accountId, description: `Water bills · ${a.accountNo} (1 unpaid incl. penalties)`, amount: String(P(440)), payable: true },
    ]);
    const r = await payWater(a.customer.id, a.accountId, "100.00");
    if (!r.ok) throw new Error(r.error);
    const { receiptItems } = await import("@/modules/cashiering/schema");
    const [item] = await getDb().select().from(receiptItems).where(eq(receiptItems.receiptId, r.data.id));
    expect(item?.description).toBe(`Water bills · ${a.accountNo} (balance after payment ₱340.00)`);
  });

  it("two water bill items for the same account in one receipt don't pay the same bill twice", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    const teller = await tellerToday();
    const r = await runAs(teller, () =>
      issueReceiptAction({
        payor: { type: "WATER_CUSTOMER", id: a.customer.id, name: "" },
        mode: "CASH",
        checkNo: null,
        birReceiptNo: "BIR-2X",
        items: [
          { type: "WATER_BILL", refId: a.accountId, amount: "400.00", description: null },
          { type: "WATER_BILL", refId: a.accountId, amount: "400.00", description: null },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect((await billsOf(a.accountId)).map((b) => b.status)).toEqual(["PAID", "PAID"]);
    expect(await accountOutstanding(a.accountId)).toBe(0n);
  });

  it("cancelling the payment receipt restores the bills; once its advance was applied it can't be cancelled", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-05"));
    const paid = await payWater(a.customer.id, a.accountId, "400.00");
    if (!paid.ok) throw new Error(paid.error);
    expect((await billsOf(a.accountId))[0]?.status).toBe("PAID");
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: paid.data.id, reason: "Wrong account" }))).toEqual({ ok: true, data: undefined });
    expect((await billsOf(a.accountId))[0]?.status).toBe("UNPAID");
    expect(await accountOutstanding(a.accountId)).toBe(P(400));
    expect(await arFor(a.customer.id)).toBe(P(400));

    setClock(() => at("2026-11-30"));
    const over = await payWater(a.customer.id, a.accountId, "500.00");
    if (!over.ok) throw new Error(over.error);
    await billMonth(clerk, zoneId, "2026-11", [[a.accountId, 36]]);
    const blocked = await runAs(manager, () => cancelReceiptAction({ receiptId: over.data.id, reason: "Oops" }));
    expect(blocked).toEqual({ ok: false, error: "The advance from this receipt was already applied to a bill; it can't be cancelled" });
  });

  it("a bill fully covered by an advance is PAID when posted", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    setClock(() => at("2026-10-05"));
    expect((await payWater(a.customer.id, a.accountId, "800.00")).ok).toBe(true);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    expect((await billsOf(a.accountId)).map((b) => [b.advanceApplied, b.status])).toEqual(
      expect.arrayContaining([
        [0n, "PAID"],
        [P(400), "PAID"],
      ]),
    );
  });
});

describe("T7.3 cron and penalties", () => {
  it("the cron route needs CRON_SECRET; it runs the jobs once per business date", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret-123";
    try {
      expect((await cronDaily(new Request("http://x/api/cron/daily"))).status).toBe(401);
      expect((await cronDaily(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
      const a = await acc();
      await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
      setClock(() => at("2026-11-16"));
      const ok = await cronDaily(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer test-secret-123" } }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ date: "2026-11-16", results: expect.arrayContaining([expect.objectContaining({ job: "water-penalties", status: "ran" })]) });
      const again = await cronDaily(new Request("http://x/api/cron/daily", { headers: { authorization: "Bearer test-secret-123" } }));
      expect(await again.json()).toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ job: "water-penalties", status: "skipped" })]) });
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it("no penalty on a bill paid by its due date; payments after the due date don't avoid it", async () => {
    const onTime = await acc();
    const late = await acc();
    await billMonth(clerk, zoneId, "2026-10", [
      [onTime.accountId, 18],
      [late.accountId, 18],
    ]);
    setClock(() => at("2026-11-15"));
    expect((await payWater(onTime.customer.id, onTime.accountId, "400.00")).ok).toBe(true);
    setClock(() => at("2026-11-20"));
    expect((await payWater(late.customer.id, late.accountId, "400.00")).ok).toBe(true);
    await runDailyJobs("2026-11-20");
    const penalties = await getDb().select().from(waterPenalties);
    expect(penalties.map((p) => p.amount)).toEqual([P(40)]);
    const [lateBill] = await billsOf(late.accountId);
    expect(penalties[0]?.billId).toBe(lateBill?.id);
    expect(lateBill?.status).toBe("PARTIAL");
  });

  it("allocations and penalties are immutable", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-16"));
    await runDailyJobs("2026-11-16");
    expect((await payWater(a.customer.id, a.accountId, "100.00")).ok).toBe(true);
    await expect(getDb().execute(sql`UPDATE water_payment_allocations SET bill_part = 1`)).rejects.toThrow();
    await expect(getDb().execute(sql`DELETE FROM water_penalties`)).rejects.toThrow();
    expect(await getDb().select().from(waterPaymentAllocations)).toHaveLength(1);
  });
});

describe("T7.4 disconnection", () => {
  async function twoUnpaid() {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    setClock(() => at("2026-11-02"));
    return a;
  }

  it("notices need enough unpaid bills, one open notice at a time, and the notice period before disconnecting", async () => {
    const a = await acc();
    const one = await acc();
    await billMonth(clerk, zoneId, "2026-09", [
      [a.accountId, 18],
      [one.accountId, 18],
    ]);
    await billMonth(clerk, zoneId, "2026-10", [
      [a.accountId, 36],
      [one.accountId, 36],
    ]);
    setClock(() => at("2026-11-02"));
    expect((await payWater(one.customer.id, one.accountId, "400.00")).ok).toBe(true);
    expect(await runAs(clerk, () => issueNoticeAction({ accountId: one.accountId }))).toEqual({ ok: false, error: `${one.accountNo} has 1 unpaid bill; a notice needs 2` });

    const n = await runAs(clerk, () => issueNoticeAction({ accountId: a.accountId }));
    if (!n.ok) throw new Error(n.error);
    expect(n.data.noticeNo).toMatch(/^DN-2026-\d{5}$/);
    expect(await runAs(clerk, () => issueNoticeAction({ accountId: a.accountId }))).toEqual({ ok: false, error: `${a.accountNo} already has notice ${n.data.noticeNo}` });
    expect((await disconnectionList()).find((x) => x.accountId === a.accountId)?.notice?.noticeNo).toBe(n.data.noticeNo);
    expect(await runAs(clerk, () => disconnectAction({ disconnectionId: n.data.id, reading: 40 }))).toEqual({ ok: false, error: `Notice ${n.data.noticeNo} gives the customer until 2026-11-09; disconnect after that` });
    expect(await runAs(clerk, () => cancelNoticeAction({ disconnectionId: n.data.id, reason: "Promised to pay" }))).toEqual({ ok: true, data: undefined });
  });

  it("the reconnection fee is the exact amount, for the disconnected account only, and a used fee can't be refunded", async () => {
    const a = await twoUnpaid();
    const teller = await tellerToday();
    const fee = (refId: string, amount: string) =>
      runAs(teller, () =>
        issueReceiptAction({ payor: { type: "WATER_CUSTOMER", id: a.customer.id, name: "" }, mode: "CASH", checkNo: null, birReceiptNo: `BIR-F-${amount}`, items: [{ type: "WATER_OTHER_FEE", refId, amount, description: null }] }),
      );
    expect(await fee(`RECONNECTION:${a.accountId}`, "300.00")).toEqual({ ok: false, error: `${a.accountNo} is ACTIVE; a reconnection fee is collected only for a disconnected account` });
    const n = await runAs(clerk, () => issueNoticeAction({ accountId: a.accountId }));
    if (!n.ok) throw new Error(n.error);
    setClock(() => at("2026-11-09"));
    expect((await runAs(clerk, () => disconnectAction({ disconnectionId: n.data.id, reading: 40 }))).ok).toBe(true);
    expect((await payWater(a.customer.id, a.accountId, "800.00")).ok).toBe(true);
    expect(await runAs(clerk, () => reconnectAction({ disconnectionId: n.data.id, reading: 40 }))).toEqual({ ok: false, error: "Collect the reconnection fee (₱300.00) at the teller first" });

    const teller2 = await tellerToday();
    const pay = (refId: string, amount: string) =>
      runAs(teller2, () =>
        issueReceiptAction({ payor: { type: "WATER_CUSTOMER", id: a.customer.id, name: "" }, mode: "CASH", checkNo: null, birReceiptNo: `BIR2-${amount}`, items: [{ type: "WATER_OTHER_FEE", refId, amount, description: null }] }),
      );
    expect(await pay(`RECONNECTION:${a.accountId}`, "1.00")).toEqual({ ok: false, error: "Reconnection fee is ₱300.00" });
    expect(await pay("RECONNECTION", "300.00")).toEqual({ ok: false, error: "Choose the disconnected account the reconnection fee is for" });
    const dues = await runAs(teller2, () => duesAction({ payor: { type: "WATER_CUSTOMER", id: a.customer.id, name: "" } }));
    expect(dues.ok && dues.data.filter((d) => d.type === "WATER_OTHER_FEE").map((d) => [d.refId, d.amount])).toEqual([[`RECONNECTION:${a.accountId}`, String(P(300))]]);
    const paid = await pay(`RECONNECTION:${a.accountId}`, "300.00");
    if (!paid.ok) throw new Error(paid.error);
    expect((await runAs(clerk, () => reconnectAction({ disconnectionId: n.data.id, reading: 40 }))).ok).toBe(true);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: paid.data.id, reason: "Refund" }))).toEqual({ ok: false, error: expect.stringMatching(/was used for DN-2026-\d{5}; the receipt can't be cancelled/) });
  });
});

describe("T7.5 closure settlement", () => {
  it("a deposit smaller than what's owed is all offset; no DV; the rest stays in AR", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 40]]);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 80]]);
    setClock(() => at("2026-11-03"));
    const p = await runAs(clerk, () => openPeriodAction({ period: "2026-11", zoneId, readingFrom: "2026-11-01", readingTo: "2026-11-25", billDate: "2026-11-30" }));
    if (!p.ok) throw new Error(p.error);
    const owedBefore = await accountOutstanding(a.accountId);
    const closed = await runAs(clerk, () => closeAccountAction({ accountId: a.accountId, finalReading: 80, rollover: false, reason: "Demolished" }));
    if (!closed.ok) throw new Error(closed.error);
    const final = P(200);
    expect(closed.data.settlement).toMatchObject({ deposit: String(P(1000)), unpaid: String(owedBefore + final), offset: String(P(1000)), refund: "0", dvId: null });
    expect(await arFor(a.customer.id)).toBe(owedBefore + final - P(1000));
    expect(await getDb().select().from(disbursementVouchers)).toHaveLength(0);
    expect(await getDb().select().from(waterDepositSettlements)).toHaveLength(1);
  });

  it("a payment on an account that was later closed and settled can't be cancelled", async () => {
    setClock(() => at("2026-10-01"));
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-03"));
    const paid = await payWater(a.customer.id, a.accountId, "400.00");
    if (!paid.ok) throw new Error(paid.error);
    const p = await runAs(clerk, () => openPeriodAction({ period: "2026-11", zoneId, readingFrom: "2026-11-01", readingTo: "2026-11-25", billDate: "2026-11-30" }));
    if (!p.ok) throw new Error(p.error);
    expect((await runAs(clerk, () => closeAccountAction({ accountId: a.accountId, finalReading: 18, rollover: false, reason: "Moved" }))).ok).toBe(true);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: paid.data.id, reason: "Oops" }))).toEqual({ ok: false, error: `${a.accountNo} is closed and its deposit settled; the payment can't be cancelled` });
  });
});

describe("T7.6 SOA", () => {
  it("bills, penalty, memo, payment and deposit offset: the SOA equals the GL subsidiary at every step", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    setClock(() => at("2026-10-16"));
    await runDailyJobs("2026-10-16");
    const [bill] = await billsOf(a.accountId);
    const memo = await withTx((tx) => prepareAdjustment(tx, { billId: bill!.id, kind: "CREDIT", amount: P(50), reason: "Leak" }, clerk));
    await withTx((tx) => approveAdjustment(tx, memo.id, manager));
    expect((await customerSoa(a.customer.id)).endingBalance).toBe(await arFor(a.customer.id));
    expect((await payWater(a.customer.id, a.accountId, "200.00")).ok).toBe(true);
    const soa = await customerSoa(a.customer.id);
    expect(soa.lines.map((l) => l.kind)).toEqual(["BILL", "PENALTY", "CREDIT_MEMO", "PAYMENT"]);
    expect(soa.endingBalance).toBe(P(400) + P(40) - P(50) - P(200));
    expect(soa.endingBalance).toBe(await arFor(a.customer.id));
  });
});

describe("T7.7 production readings, NRW and tiles", () => {
  it("NRW % = (produced − billed) ÷ produced for the month", async () => {
    const a = await acc();
    const add = (readingDate: string, reading: number) => runAs(clerk, () => addProductionReadingAction({ source: "well-1", readingDate, reading }));
    expect((await add("2026-09-30", 1000)).ok).toBe(true);
    expect((await add("2026-10-31", 1025)).ok).toBe(true);
    expect(await add("2026-11-30", 900)).toEqual({ ok: false, error: "The reading is lower than WELL-1's previous reading (1,025)" });
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 20]]);
    expect(await nrw("2026-10")).toEqual({ period: "2026-10", produced: 25, billed: 20, nrwM3: 5, nrwPercent: "20.00" });
    const tiles = await waterTiles("2026-10");
    expect(tiles).toMatchObject({ billed: P(450), nrwPercent: "20.00", forDisconnection: 0 });
  });
});
