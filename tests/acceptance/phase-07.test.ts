import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { runDailyJobs } from "@/lib/cron";
import { disbursementVouchers, dvLines, receipts } from "@/modules/cashiering/schema";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { closeAccountAction } from "@/modules/water/billing-actions";
import { disconnectAction, issueNoticeAction, reconnectAction } from "@/modules/water/collection-actions";
import { accountOutstanding, disconnectionList } from "@/modules/water/collections";
import { agingReport, billingSummary, collectionEfficiency, customerSoa } from "@/modules/water/reports";
import { waterAccounts, waterBills, waterCustomerAdvances, waterPaymentAllocations, waterPenalties } from "@/modules/water/schema";
import { acct, P } from "../helpers/phase03";
import { activeAccount } from "../helpers/phase06";
import { at, billMonth, payReconnectionFee, payWater, setupCollections } from "../helpers/phase07";

// Golden values from docs/phases/PHASE-07-water-collections.md › Acceptance tests (bills due the
// 15th of the next month). A7.3 uses ₱140.00 left: the spec's ₱180.00 contradicts its own
// allocation (400 − 260 = 140); corrected with Rhold's approval on 2026-10-09 (PROGRESS.md).

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

async function bill(accountId: string, periodId: string) {
  const [b] = await getDb().select().from(waterBills).where(and(eq(waterBills.accountId, accountId), eq(waterBills.periodId, periodId)));
  return b!;
}

async function arFor(customerId: string) {
  const ar = await acct("ar_water");
  const lines = await getDb().select().from(journalLines).where(and(eq(journalLines.accountId, ar), eq(journalLines.customerId, customerId)));
  return lines.reduce((s, l) => s + l.debit - l.credit, 0n);
}

describe("Phase 07 acceptance", () => {
  it("A7.1 pay the 2026-10 bill ₱400.00 on 2026-11-10 → bill PAID; customer AR–Water ₱0.00; CRJ Dr Cash 400 / Cr AR–Water 400", async () => {
    const a = await acc();
    const { periodId } = await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-10"));
    const r = await payWater(a.customer.id, a.accountId, "400.00");
    if (!r.ok) throw new Error(r.error);
    expect((await bill(a.accountId, periodId)).status).toBe("PAID");
    expect(await arFor(a.customer.id)).toBe(0n);
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, r.data.jeId));
    expect(je?.book).toBe("CRJ");
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, r.data.jeId));
    const [cash, ar] = await Promise.all([acct("cash_on_hand"), acct("ar_water")]);
    expect(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }))).toEqual(
      expect.arrayContaining([
        { accountId: cash, debit: P(400), credit: 0n },
        { accountId: ar, debit: 0n, credit: P(400) },
      ]),
    );
    expect(lines).toHaveLength(2);
  });

  it("A7.2 bill ₱400.00 due 2026-11-15 unpaid; daily job for 2026-11-16 run twice → one penalty ₱40.00 (Dr AR–Water / Cr Penalty Income–Water)", async () => {
    const a = await acc();
    const { periodId } = await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    const b = await bill(a.accountId, periodId);
    expect(b.dueDate).toBe("2026-11-15");
    setClock(() => at("2026-11-16"));
    await runDailyJobs("2026-11-16");
    await runDailyJobs("2026-11-16");
    const penalties = await getDb().select().from(waterPenalties).where(eq(waterPenalties.billId, b.id));
    expect(penalties.map((p) => [p.amount, p.assessedOn])).toEqual([[P(40), "2026-11-16"]]);
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, penalties[0]!.jeId));
    const [ar, pen] = await Promise.all([acct("ar_water"), acct("penalty_income_water")]);
    expect(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, customerId: l.customerId }))).toEqual(
      expect.arrayContaining([
        { accountId: ar, debit: P(40), credit: 0n, customerId: a.customer.id },
        { accountId: pen, debit: 0n, credit: P(40), customerId: null },
      ]),
    );
  });

  it("A7.3 pay ₱300.00 on that bill (₱40.00 penalty + ₱400.00) → penalty 40.00, bill 260.00; bill PARTIAL with ₱140.00 left", async () => {
    const a = await acc();
    const { periodId } = await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-16"));
    await runDailyJobs("2026-11-16");
    setClock(() => at("2026-11-20"));
    const r = await payWater(a.customer.id, a.accountId, "300.00");
    if (!r.ok) throw new Error(r.error);
    const b = await bill(a.accountId, periodId);
    const alloc = await getDb().select().from(waterPaymentAllocations).where(eq(waterPaymentAllocations.billId, b.id));
    expect(alloc.map((x) => [x.penaltyPart, x.billPart])).toEqual([[P(40), P(260)]]);
    expect(b.status).toBe("PARTIAL");
    expect(await accountOutstanding(a.accountId)).toBe(P(140));
  });

  it("A7.4 owes Sept ₱400.00 + penalty ₱40.00 and Oct ₱400.00; pays ₱500.00 → Sept penalty 40, Sept bill 400, Oct 60; Oct PARTIAL with ₱340.00 left", async () => {
    const a = await acc();
    const sep = await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    setClock(() => at("2026-10-16"));
    await runDailyJobs("2026-10-16");
    const oct = await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    setClock(() => at("2026-11-05"));
    const r = await payWater(a.customer.id, a.accountId, "500.00");
    if (!r.ok) throw new Error(r.error);
    const sepBill = await bill(a.accountId, sep.periodId);
    const octBill = await bill(a.accountId, oct.periodId);
    const allocs = await getDb().select().from(waterPaymentAllocations);
    const of = (billId: string) => allocs.filter((x) => x.billId === billId).map((x) => [x.penaltyPart, x.billPart]);
    expect(of(sepBill.id)).toEqual([[P(40), P(400)]]);
    expect(of(octBill.id)).toEqual([[0n, P(60)]]);
    expect(sepBill.status).toBe("PAID");
    expect(octBill.status).toBe("PARTIAL");
    expect(await accountOutstanding(a.accountId)).toBe(P(340));
  });

  it("A7.5 pay ₱500.00 on a single ₱400.00 bill, then the next billing run → advance ₱100.00; next bill advance applied ₱100.00 (Dr Customers' Advances / Cr AR–Water)", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 18]]);
    setClock(() => at("2026-11-10"));
    const r = await payWater(a.customer.id, a.accountId, "500.00");
    if (!r.ok) throw new Error(r.error);
    const adv = await getDb().select().from(waterCustomerAdvances).where(eq(waterCustomerAdvances.customerId, a.customer.id));
    expect(adv.map((x) => x.amount)).toEqual([P(100)]);
    const nov = await billMonth(clerk, zoneId, "2026-11", [[a.accountId, 36]]);
    expect((await bill(a.accountId, nov.periodId)).advanceApplied).toBe(P(100));
    const [ar, advAcct] = await Promise.all([acct("ar_water"), acct("customers_advances")]);
    const lines = await getDb().select().from(journalLines).where(and(eq(journalLines.jeId, nov.jeId), eq(journalLines.customerId, a.customer.id)));
    expect(lines.filter((l) => l.accountId === advAcct).map((l) => [l.debit, l.credit])).toEqual([[P(100), 0n]]);
    expect(lines.filter((l) => l.accountId === ar && l.credit > 0n).map((l) => l.credit)).toEqual([P(100)]);
  });

  it("A7.6 account with 2 unpaid bills / with 1 unpaid bill → on the disconnection list / not on it", async () => {
    const two = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[two.accountId, 18]]);
    const one = await acc();
    await billMonth(clerk, zoneId, "2026-10", [
      [two.accountId, 36],
      [one.accountId, 18],
    ]);
    const list = (await disconnectionList()).map((x) => x.accountId);
    expect(list).toContain(two.accountId);
    expect(list).not.toContain(one.accountId);
  });

  it("A7.7 reconnect before paying arrears → rejected; after arrears + penalty + ₱300.00 fee → reconnection allowed → ACTIVE", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    setClock(() => at("2026-11-16"));
    await runDailyJobs("2026-11-16");
    const notice = await runAs(clerk, () => issueNoticeAction({ accountId: a.accountId }));
    if (!notice.ok) throw new Error(notice.error);
    setClock(() => at("2026-11-23"));
    expect((await runAs(clerk, () => disconnectAction({ disconnectionId: notice.data.id, reading: 40 }))).ok).toBe(true);
    expect((await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, a.accountId)))[0]?.status).toBe("DISCONNECTED");

    expect(await runAs(clerk, () => reconnectAction({ disconnectionId: notice.data.id, reading: 40 }))).toEqual({ ok: false, error: expect.stringMatching(/arrears/i) });
    const owed = await accountOutstanding(a.accountId);
    expect(owed).toBe(P(400) + P(40) + P(400) + P(40));
    const pay = await payWater(a.customer.id, a.accountId, "880.00");
    if (!pay.ok) throw new Error(pay.error);
    expect(await runAs(clerk, () => reconnectAction({ disconnectionId: notice.data.id, reading: 40 }))).toEqual({ ok: false, error: expect.stringMatching(/reconnection fee/i) });
    const fee = await payReconnectionFee(a.customer.id);
    if (!fee.ok) throw new Error(fee.error);
    expect((await runAs(clerk, () => reconnectAction({ disconnectionId: notice.data.id, reading: 40 }))).ok).toBe(true);
    expect((await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, a.accountId)))[0]?.status).toBe("ACTIVE");
  });

  it("A7.8 next billing run with a DISCONNECTED account → no bill for that account", async () => {
    const a = await acc();
    const other = await acc();
    await billMonth(clerk, zoneId, "2026-09", [
      [a.accountId, 18],
      [other.accountId, 18],
    ]);
    await billMonth(clerk, zoneId, "2026-10", [
      [a.accountId, 36],
      [other.accountId, 36],
    ]);
    setClock(() => at("2026-11-02"));
    const notice = await runAs(clerk, () => issueNoticeAction({ accountId: a.accountId }));
    if (!notice.ok) throw new Error(notice.error);
    setClock(() => at("2026-11-09"));
    expect((await runAs(clerk, () => disconnectAction({ disconnectionId: notice.data.id, reading: 40 }))).ok).toBe(true);
    const nov = await billMonth(clerk, zoneId, "2026-11", [[other.accountId, 50]]);
    const bills = await getDb().select().from(waterBills).where(eq(waterBills.periodId, nov.periodId));
    expect(bills.map((b) => b.accountId)).toEqual([other.accountId]);
  });

  it("A7.9 aging as of 2026-12-31: unpaid bills due 2026-12-15, 2026-11-15, 2026-09-15 (₱400.00 each) → 1–30 ₱400.00, 31–60 ₱400.00, >90 ₱400.00", async () => {
    setClock(() => at("2026-08-01"));
    const a = await acc({ initialReading: 0 });
    await billMonth(clerk, zoneId, "2026-08", [[a.accountId, 18]]);
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 36]]);
    await billMonth(clerk, zoneId, "2026-11", [[a.accountId, 54]]);
    const aging = await agingReport("2026-12-31");
    const row = aging.rows.find((r) => r.accountId === a.accountId)!;
    expect(row).toMatchObject({ current: 0n, d1_30: P(400), d31_60: P(400), d61_90: 0n, over90: P(400), total: P(1200) });
    expect(aging.bills.filter((b) => b.accountId === a.accountId).map((b) => b.daysPastDue).sort((x, y) => x - y)).toEqual([16, 46, 107]);
  });

  it("A7.10 customer SOA ending balance = the GL AR–Water subsidiary balance for the customer", async () => {
    const a = await acc();
    await billMonth(clerk, zoneId, "2026-09", [[a.accountId, 18]]);
    setClock(() => at("2026-10-16"));
    await runDailyJobs("2026-10-16");
    await billMonth(clerk, zoneId, "2026-10", [[a.accountId, 40]]);
    setClock(() => at("2026-11-03"));
    const r = await payWater(a.customer.id, a.accountId, "500.00");
    if (!r.ok) throw new Error(r.error);
    const soa = await customerSoa(a.customer.id);
    expect(soa.endingBalance).toBe(await arFor(a.customer.id));
    expect(soa.endingBalance).toBe(P(400) + P(40) + P(510) - P(500));
    expect(soa.lines.at(-1)?.balance).toBe(soa.endingBalance);
  });

  it("A7.11 billing summary 2026-10 on the A6.8 fixture → members ₱800.00; non-members ₱925.00; senior discount ₱20.00; net billed ₱1,705.00", async () => {
    setClock(() => at("2026-10-01"));
    const member = await acc({ kind: "MEMBER" });
    const non = await acc({ kind: "NON_MEMBER" });
    const senior = await acc({ kind: "MEMBER", senior: true });
    await billMonth(clerk, zoneId, "2026-10", [
      [member.accountId, 18],
      [non.accountId, 35],
      [senior.accountId, 18],
    ]);
    const s = await billingSummary("2026-10");
    expect(s.totals).toMatchObject({ members: P(800), nonMembers: P(925), seniorDiscount: P(20), net: P(1705) });
  });

  it("A7.12 billed due in Nov ₱1,705.00; collected on those bills ₱1,305.00 → collection efficiency 76.54%", async () => {
    setClock(() => at("2026-10-01"));
    const member = await acc({ kind: "MEMBER" });
    const non = await acc({ kind: "NON_MEMBER" });
    const senior = await acc({ kind: "MEMBER", senior: true });
    await billMonth(clerk, zoneId, "2026-10", [
      [member.accountId, 18],
      [non.accountId, 35],
      [senior.accountId, 18],
    ]);
    setClock(() => at("2026-11-10"));
    expect((await payWater(non.customer.id, non.accountId, "925.00")).ok).toBe(true);
    expect((await payWater(senior.customer.id, senior.accountId, "380.00")).ok).toBe(true);
    const e = await collectionEfficiency("2026-11");
    expect(e).toMatchObject({ billed: P(1705), collected: P(1305), percent: "76.54" });
  });

  it("A7.13 close an account with a ₱1,000.00 deposit and ₱400.00 unpaid → ₱400.00 offset against AR; ₱600.00 refunded via DV", async () => {
    setClock(() => at("2026-10-01"));
    const a = await acc();
    expect((await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, a.accountId)))[0]?.depositAmount).toBe(P(1000));
    await openPeriodForClosure();
    const closed = await runAs(clerk, () => closeAccountAction({ accountId: a.accountId, finalReading: 18, rollover: false, reason: "Moved away" }));
    if (!closed.ok) throw new Error(closed.error);
    expect(closed.data.settlement).toMatchObject({ unpaid: String(P(400)), offset: String(P(400)), refund: String(P(600)) });

    const [deposits, ar] = await Promise.all([acct("customers_deposits"), acct("ar_water")]);
    const offsetLines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, closed.data.settlement.offsetJeId!));
    expect(offsetLines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, customerId: l.customerId }))).toEqual(
      expect.arrayContaining([
        { accountId: deposits, debit: P(400), credit: 0n, customerId: a.customer.id },
        { accountId: ar, debit: 0n, credit: P(400), customerId: a.customer.id },
      ]),
    );
    const [dv] = await getDb().select().from(disbursementVouchers).where(eq(disbursementVouchers.id, closed.data.settlement.dvId!));
    expect(dv).toMatchObject({ amount: P(600), status: "DRAFT" });
    const dvl = await getDb().select().from(dvLines).where(eq(dvLines.dvId, dv!.id));
    expect(dvl.map((l) => ({ accountId: l.accountId, amount: l.amount, customerId: l.customerId }))).toEqual([{ accountId: deposits, amount: P(600), customerId: a.customer.id }]);
    expect(await arFor(a.customer.id)).toBe(0n);
    expect(await getDb().select().from(receipts)).toHaveLength(1);

    async function openPeriodForClosure() {
      const { openPeriodAction } = await import("@/modules/water/billing-actions");
      const p = await runAs(clerk, () => openPeriodAction({ period: "2026-10", zoneId, readingFrom: "2026-10-01", readingTo: "2026-10-25", billDate: "2026-10-31" }));
      if (!p.ok) throw new Error(p.error);
    }
  });
});
