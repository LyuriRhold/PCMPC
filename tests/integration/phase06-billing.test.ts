import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { runAs, SodError } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { hasRun, JobAlreadyRunError, runOnce } from "@/lib/jobs";
import { jobRuns } from "@/modules/jobs/schema";
import { journalLines } from "@/modules/ledger/schema";
import { postJournal } from "@/modules/ledger/service";
import { approveAdjustment, prepareAdjustment } from "@/modules/water/billing";
import {
  addRouteAction,
  addZoneAction,
  approveReadingAction,
  assignReaderAction,
  closeAccountAction,
  closePeriodAction,
  enterEstimateAction,
  excludeAccountAction,
  openPeriodAction,
  postBillingAction,
  previewBillingAction,
  rejectReadingAction,
  syncReadingsAction,
} from "@/modules/water/billing-actions";
import {
  waterAccounts,
  waterBillingPeriods,
  waterBillLines,
  waterBills,
  waterMeters,
  waterReadings,
} from "@/modules/water/schema";
import { makeUser, seedReference } from "../helpers/phase01";
import { acct, P } from "../helpers/phase03";
import { activeAccount, openPeriod, read, readApproved, setupBilling } from "../helpers/phase06";

afterEach(() => setClock(null));

describe("T6.1 runOnce", () => {
  beforeEach(async () => {
    await seedReference();
  });

  it("runs a key once, stores the result, and refuses a second run", async () => {
    const out = await withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({ bills: 3, total: 120000n })));
    expect(out).toEqual({ bills: 3, total: 120000n });
    const [row] = await getDb().select().from(jobRuns).where(eq(jobRuns.key, "2026-10:Z1"));
    expect(row?.result).toEqual({ bills: 3, total: "120000" });
    expect(await hasRun(getDb(), "test-job", "2026-10:Z1")).toBe(true);
    await expect(withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({})))).rejects.toBeInstanceOf(JobAlreadyRunError);
    await expect(withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({}), (k) => `${k} is already billed`))).rejects.toThrow("2026-10:Z1 is already billed");
  });

  it("a failed run leaves no claim, so it can be retried", async () => {
    await expect(withTx((tx) => runOnce(tx, "test-job", "k1", null, async () => Promise.reject(new Error("boom"))))).rejects.toThrow("boom");
    expect(await hasRun(getDb(), "test-job", "k1")).toBe(false);
    expect(await withTx((tx) => runOnce(tx, "test-job", "k1", null, async () => ({ ok: true })))).toEqual({ ok: true });
  });

  it("two concurrent runs of the same key: exactly one succeeds", async () => {
    const results = await Promise.allSettled([1, 2].map(() => withTx((tx) => runOnce(tx, "test-job", "race", null, async () => ({ n: 1 })))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof JobAlreadyRunError)).toHaveLength(1);
  });
});

describe("billing (T6.3–T6.8)", () => {
  let clerk = "";
  let manager = "";
  let reader = "";
  let zoneId = 0;
  let routeId = "";
  beforeEach(async () => {
    const u = await setupBilling();
    clerk = u.clerk.id;
    manager = u.manager.id;
    reader = u.reader.id;
    zoneId = u.zoneId;
    routeId = u.routeId;
  });
  const acc = (o: Partial<Parameters<typeof activeAccount>[0]> = {}) => activeAccount({ clerk, manager, routeId, ...o });
  const periodRow = async (id: string) => (await getDb().select().from(waterBillingPeriods).where(eq(waterBillingPeriods.id, id)))[0]!;

  describe("T6.3 periods and readings", () => {
    it("opens a period once per zone, due date = bill date + 15 days; status OPEN → READING → REVIEW → BILLED → CLOSED", async () => {
      const a = await acc({ initialReading: 0 });
      const b = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      expect(await periodRow(periodId)).toMatchObject({ status: "OPEN", billDate: "2026-10-07", dueDate: "2026-10-22" });
      const again = await runAs(clerk, () => openPeriodAction({ period: "2026-10", zoneId, readingFrom: "2026-10-01", readingTo: "2026-10-05", billDate: "2026-10-07" }));
      expect(again).toEqual({ ok: false, error: "2026-10 is already open for Z1" });

      await readApproved(clerk, periodId, a.accountId, 10);
      expect((await periodRow(periodId)).status).toBe("READING");
      await readApproved(clerk, periodId, b.accountId, 12);
      expect((await periodRow(periodId)).status).toBe("REVIEW");
      expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
      expect((await periodRow(periodId)).status).toBe("BILLED");
      expect(await read(clerk, periodId, a.accountId, 20)).toEqual({ ok: false, error: "2026-10 for Z1 is already billed" });
      expect(await runAs(clerk, () => closePeriodAction({ periodId }))).toEqual({ ok: true, data: undefined });
      expect((await periodRow(periodId)).status).toBe("CLOSED");
    });

    it("office re-entry replaces an unbilled reading; a rejected reading blocks the run until re-read", async () => {
      const a = await acc({ initialReading: 100 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      const first = await read(clerk, periodId, a.accountId, 100);
      expect(first.ok && { consumption: first.data.consumption, flags: first.data.flags, status: first.data.status }).toEqual({ consumption: 0, flags: ["ZERO"], status: "ENTERED" });
      if (!first.ok) return;
      expect(await runAs(clerk, () => rejectReadingAction({ readingId: first.data.id, reason: "Re-check the dial" }))).toEqual({ ok: true, data: undefined });
      expect(await runAs(clerk, () => postBillingAction({ periodId }))).toEqual({ ok: false, error: expect.stringContaining("reading rejected") });
      const second = await read(clerk, periodId, a.accountId, 112);
      expect(second.ok && { consumption: second.data.consumption, status: second.data.status }).toEqual({ consumption: 12, status: "APPROVED" });
      expect(await getDb().select().from(waterReadings).where(eq(waterReadings.accountId, a.accountId))).toHaveLength(1);
    });

    it("an approved exclusion lets the run go ahead without that account", async () => {
      const a = await acc({ initialReading: 0 });
      const b = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      await readApproved(clerk, periodId, a.accountId, 15);
      expect(await runAs(clerk, () => excludeAccountAction({ periodId, accountId: b.accountId, reason: "House demolished, closure pending" }))).toEqual({ ok: true, data: undefined });
      const run = await runAs(clerk, () => postBillingAction({ periodId }));
      expect(run.ok && run.data.bills).toBe(1);
    });

    it("an estimate needs actual history; a reading of another zone's account is refused", async () => {
      const a = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      expect(await runAs(clerk, () => enterEstimateAction({ periodId, accountId: a.accountId, reason: "Dog" }))).toEqual({ ok: false, error: `${a.accountNo} has no actual readings to estimate from` });
      const z2 = await runAs(clerk, () => addZoneAction({ code: "z2", name: "Zone 2" }));
      if (!z2.ok) throw new Error(z2.error);
      const other = await openPeriod(clerk, z2.data.id, "2026-10");
      expect(await read(clerk, other, a.accountId, 5)).toEqual({ ok: false, error: `${a.accountNo} isn't in this period's zone` });
    });

    it("adds zones and routes with unique codes", async () => {
      expect(await runAs(clerk, () => addZoneAction({ code: "Z1", name: "Again" }))).toEqual({ ok: false, error: "Zone Z1 already exists" });
      expect((await runAs(clerk, () => addRouteAction({ zoneId, code: "z1-r2", name: "Second" }))).ok).toBe(true);
      expect(await runAs(clerk, () => addRouteAction({ zoneId, code: "Z1-R2", name: "Dup" }))).toEqual({ ok: false, error: "Route Z1-R2 already exists" });
    });
  });

  describe("T6.4 mobile sync", () => {
    it("readers sync only their assigned routes; a second item for the same account is a duplicate", async () => {
      const a = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      const item = (uuid: string, present: number) => ({ clientUuid: uuid, periodId, accountId: a.accountId, presentReading: present, rollover: false, remarks: null, readAt: "2026-10-03T02:00:00.000Z" });
      const denied = await runAs(reader, () => syncReadingsAction({ items: [item("11111111-1111-4111-8111-111111111111", 9)] }));
      expect(denied.ok && denied.data[0]).toEqual({ clientUuid: "11111111-1111-4111-8111-111111111111", status: "error", error: "This account isn't on your assigned routes" });

      expect(await runAs(clerk, () => assignReaderAction({ routeId, readerId: clerk }))).toEqual({ ok: false, error: "Only meter readers can be assigned to a route" });
      expect((await runAs(clerk, () => assignReaderAction({ routeId, readerId: reader }))).ok).toBe(true);
      const saved = await runAs(reader, () => syncReadingsAction({ items: [item("22222222-2222-4222-8222-222222222222", 9), item("33333333-3333-4333-8333-333333333333", 11)] }));
      expect(saved.ok && saved.data.map((r) => r.status)).toEqual(["saved", "duplicate"]);
      const rows = await getDb().select().from(waterReadings).where(eq(waterReadings.accountId, a.accountId));
      expect(rows.map((r) => [r.presentReading, r.readerId])).toEqual([[9, reader]]);
    });
  });

  describe("T6.5 billing", () => {
    it("numbers bills WB-YYYYMM-000001 in route order and itemizes the charge", async () => {
      const a = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      await readApproved(clerk, periodId, a.accountId, 35);
      expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
      const [bill] = await getDb().select().from(waterBills).where(eq(waterBills.accountId, a.accountId));
      expect(bill).toMatchObject({ billNo: "WB-202610-000001", consumption: 35, currentAmount: P(925), dueDate: "2026-10-22", status: "UNPAID" });
      const lines = await getDb().select().from(waterBillLines).where(eq(waterBillLines.billId, bill!.id));
      expect(lines.map((l) => [l.kind, l.amount])).toEqual([
        ["MIN_CHARGE", P(200)],
        ["BLOCK", P(250)],
        ["BLOCK", P(300)],
        ["BLOCK", P(175)],
      ]);
    });

    it("applies the customer's advance: Dr Customers' Advances / Cr AR–Water in the run's entry", async () => {
      const a = await acc({ initialReading: 0 });
      const [cash, adv] = await Promise.all([acct("cash_on_hand"), acct("customers_advances")]);
      await withTx((tx) =>
        postJournal(tx, { date: "2026-10-02", book: "GJ", particulars: "Advance payment", lines: [{ accountId: cash, debit: P(250) }, { accountId: adv, credit: P(250), customerId: a.customer.id }] }, manager),
      );
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      await readApproved(clerk, periodId, a.accountId, 18);
      const preview = await runAs(clerk, () => previewBillingAction({ periodId }));
      expect(preview.ok && preview.data.bills[0]).toMatchObject({ currentAmount: String(P(400)), advanceApplied: String(P(250)), totalAmountDue: String(P(150)) });
      const run = await runAs(clerk, () => postBillingAction({ periodId }));
      if (!run.ok) throw new Error(run.error);
      const ar = await acct("ar_water");
      const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, run.data.jeId));
      const net = (id: string) => lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0n);
      expect(net(ar)).toBe(P(150));
      expect(net(adv)).toBe(P(250));
    });

    it("posted bills and lines are immutable in the database; only the status can change", async () => {
      const a = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      await readApproved(clerk, periodId, a.accountId, 18);
      await runAs(clerk, () => postBillingAction({ periodId }));
      const [bill] = await getDb().select().from(waterBills).where(eq(waterBills.accountId, a.accountId));
      await expect(getDb().execute(sql`UPDATE water_bills SET basic_charge = 1 WHERE id = ${bill!.id}`)).rejects.toThrow();
      await expect(getDb().execute(sql`DELETE FROM water_bills WHERE id = ${bill!.id}`)).rejects.toThrow();
      await expect(getDb().execute(sql`UPDATE water_bill_lines SET amount = 1 WHERE bill_id = ${bill!.id}`)).rejects.toThrow();
      await getDb().execute(sql`UPDATE water_bills SET status = 'PARTIAL' WHERE id = ${bill!.id}`);
    });
  });

  describe("T6.7 memos", () => {
    async function billed() {
      const a = await acc({ initialReading: 0 });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      await readApproved(clerk, periodId, a.accountId, 18);
      await runAs(clerk, () => postBillingAction({ periodId }));
      const [bill] = await getDb().select().from(waterBills).where(eq(waterBills.accountId, a.accountId));
      return { ...a, bill: bill! };
    }

    it("the preparer can't approve their own memo even with both permissions (SoD)", async () => {
      const { bill } = await billed();
      const memo = await withTx((tx) => prepareAdjustment(tx, { billId: bill.id, kind: "DEBIT", amount: P(30), reason: "Unbilled usage" }, manager));
      await expect(withTx((tx) => approveAdjustment(tx, memo.id, manager))).rejects.toBeInstanceOf(SodError);
      const { jeId } = await withTx((tx) => approveAdjustment(tx, memo.id, clerk));
      const [ar, adj] = await Promise.all([acct("ar_water"), acct("water_revenue_adjustments")]);
      const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, jeId));
      expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual(expect.arrayContaining([[ar, P(30), 0n], [adj, 0n, P(30)]]));
    });

    it("a credit memo can't exceed what the bill still owes, and reduces the next previous balance", async () => {
      const { bill, accountId } = await billed();
      await expect(withTx((tx) => prepareAdjustment(tx, { billId: bill.id, kind: "CREDIT", amount: P(401), reason: "Too much" }, clerk))).rejects.toThrow("A credit memo on WB-202610-000001 can be at most ₱400.00");
      const memo = await withTx((tx) => prepareAdjustment(tx, { billId: bill.id, kind: "CREDIT", amount: P(100), reason: "Leak" }, clerk));
      await withTx((tx) => approveAdjustment(tx, memo.id, manager));
      setClock(() => new Date("2026-11-07T01:00:00Z"));
      const nov = await openPeriod(clerk, zoneId, "2026-11");
      await readApproved(clerk, nov, accountId, 36);
      const preview = await runAs(clerk, () => previewBillingAction({ periodId: nov }));
      expect(preview.ok && preview.data.bills[0]?.previousBalance).toBe(String(P(300)));
    });
  });

  describe("T6.8 final bill", () => {
    it("closing an account posts its final bill at once, frees the meter, and leaves it out of the zone run", async () => {
      const a = await acc({ initialReading: 0 });
      const b = await acc({ initialReading: 0 });
      expect(await runAs(clerk, () => closeAccountAction({ accountId: a.accountId, finalReading: 18, rollover: false, reason: "Moved out" }))).toEqual({ ok: false, error: "Open this zone's billing period first; the final reading belongs to it" });
      const periodId = await openPeriod(clerk, zoneId, "2026-10");
      const closed = await runAs(clerk, () => closeAccountAction({ accountId: a.accountId, finalReading: 18, rollover: false, reason: "Moved out" }));
      expect(closed.ok).toBe(true);
      const [bill] = await getDb().select().from(waterBills).where(eq(waterBills.accountId, a.accountId));
      expect(bill).toMatchObject({ isFinal: true, currentAmount: P(400) });
      const [account] = await getDb().select().from(waterAccounts).where(eq(waterAccounts.id, a.accountId));
      expect(account).toMatchObject({ status: "CLOSED", closedAt: "2026-10-07" });
      const [meter] = await getDb().select().from(waterMeters).where(eq(waterMeters.serialNo, a.serialNo));
      expect(meter?.status).toBe("IN_STOCK");
      const [reading] = await getDb().select().from(waterReadings).where(and(eq(waterReadings.accountId, a.accountId), eq(waterReadings.periodId, periodId)));
      expect(reading?.type).toBe("FINAL");

      await readApproved(clerk, periodId, b.accountId, 12);
      const run = await runAs(clerk, () => postBillingAction({ periodId }));
      expect(run.ok && run.data.bills).toBe(1);
    });
  });

  it("a meter reader can't open periods or post runs", async () => {
    const r = await makeUser("METER_READER", "reader2");
    await expect(runAs(r.id, () => openPeriodAction({ period: "2026-10", zoneId, readingFrom: "2026-10-01", readingTo: "2026-10-05", billDate: "2026-10-07" }))).rejects.toThrow(/forbidden/i);
    await expect(runAs(manager, () => approveReadingAction({ readingId: "00000000-0000-4000-8000-000000000000" }))).rejects.toThrow(/forbidden/i);
  });
});
