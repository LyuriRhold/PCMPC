import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { replaceMeterAction } from "@/modules/water/actions";
import {
  approveAdjustmentAction,
  assignReaderAction,
  enterEstimateAction,
  postBillingAction,
  prepareAdjustmentAction,
  previewBillingAction,
  syncReadingsAction,
} from "@/modules/water/billing-actions";
import { computeWaterCharge } from "@/modules/water/rates";
import { waterBills, waterReadings } from "@/modules/water/schema";
import { acct, P } from "../helpers/phase03";
import { activeAccount, OCT_7, openPeriod, read, readApproved, setupBilling } from "../helpers/phase06";

// Golden values from docs/phases/PHASE-06-water-billing.md › Acceptance tests (RESIDENTIAL sample tariff, CONFIRM).

let clerk = "";
let manager = "";
let reader = "";
let zoneId = "";
let routeId = "";

beforeEach(async () => {
  const u = await setupBilling();
  clerk = u.clerk.id;
  manager = u.manager.id;
  reader = u.reader.id;
  zoneId = u.zoneId;
  routeId = u.routeId;
});
afterEach(() => setClock(null));

const acc = (o: Partial<Parameters<typeof activeAccount>[0]> = {}) => activeAccount({ clerk, manager, routeId, ...o });

async function bill(accountId: string, periodId: string) {
  const [b] = await getDb().select().from(waterBills).where(and(eq(waterBills.accountId, accountId), eq(waterBills.periodId, periodId)));
  return b;
}

/** Enters actual readings for 2026-07..09 so the account has a 3-month history. */
async function history(accountId: string, presents: [number, number, number]) {
  const months = ["2026-07", "2026-08", "2026-09"];
  for (const [i, m] of months.entries()) {
    const periodId = await openPeriod(clerk, zoneId, m);
    await readApproved(clerk, periodId, accountId, presents[i]!);
  }
}

describe("Phase 06 acceptance", () => {
  it("A6.1 previous 1,250, present 1,268 → 18 m³; basic charge ₱400.00", async () => {
    const a = await acc({ initialReading: 1250 });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    const r = await read(clerk, periodId, a.accountId, 1268);
    expect(r.ok && { previous: r.data.previousReading, consumption: r.data.consumption }).toEqual({ previous: 1250, consumption: 18 });
    const preview = await runAs(clerk, () => previewBillingAction({ periodId }));
    expect(preview.ok && preview.data.bills.find((b) => b.accountId === a.accountId)?.basicCharge).toBe(String(P(400)));
  });

  it("A6.2 4-digit meter, previous 9,990, present 12, rollover marked → 22 m³; charge ₱510.00", async () => {
    const a = await acc({ initialReading: 9990, digits: 4 });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    const r = await read(clerk, periodId, a.accountId, 12, true);
    expect(r.ok && r.data.consumption).toBe(22);
    expect((await computeWaterCharge("RESIDENTIAL", 22, "2026-10-05")).total).toBe(P(510));
  });

  it('A6.3 previous 1,250, present 1,240, no rollover → rejected "Reading is lower than previous (1,250)"', async () => {
    const a = await acc({ initialReading: 1250 });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    expect(await read(clerk, periodId, a.accountId, 1240)).toEqual({ ok: false, error: "Reading is lower than previous (1,250)" });
  });

  it("A6.4 meter change: previous 1,250, old final 1,262, new initial 0, new present 9 → 21 m³; charge ₱480.00", async () => {
    const a = await acc({ initialReading: 1250 });
    const { addMeterAction } = await import("@/modules/water/actions");
    expect((await runAs(clerk, () => addMeterAction({ serialNo: "SN-NEW", brand: null, size: null, digits: 4 }))).ok).toBe(true);
    const rep = await runAs(clerk, () =>
      replaceMeterAction({ accountId: a.accountId, oldFinalReading: 1262, oldMeterStatus: "DEFECTIVE", newMeterSerial: "SN-NEW", newInitialReading: 0, reason: "Stuck dial" }),
    );
    expect(rep.ok).toBe(true);
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    const r = await read(clerk, periodId, a.accountId, 9);
    expect(r.ok && { consumption: r.data.consumption, type: r.data.type }).toEqual({ consumption: 21, type: "METER_CHANGE" });
    expect((await computeWaterCharge("RESIDENTIAL", 21, "2026-10-05")).total).toBe(P(480));
  });

  it("A6.5 last 3 actual months 12, 15, 18 (avg 15); 40 m³ → flagged HIGH; billing run blocked until approved", async () => {
    const a = await acc({ initialReading: 1000 });
    await history(a.accountId, [1012, 1027, 1045]);
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    const r = await read(clerk, periodId, a.accountId, 1085);
    expect(r.ok && { consumption: r.data.consumption, flags: r.data.flags, status: r.data.status }).toEqual({ consumption: 40, flags: ["HIGH"], status: "ENTERED" });
    const blocked = await runAs(clerk, () => postBillingAction({ periodId }));
    expect(blocked).toEqual({ ok: false, error: expect.stringContaining(a.accountNo) });
    if (!r.ok) return;
    const { approveReadingAction } = await import("@/modules/water/billing-actions");
    expect((await runAs(clerk, () => approveReadingAction({ readingId: r.data.id }))).ok).toBe(true);
    expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
  });

  it("A6.6 inaccessible meter (history 12, 15, 18): estimated 15 m³ → ₱325.00; next month 1,290 − 1,250 − 15 = 25 m³ → ₱600.00", async () => {
    const a = await acc({ initialReading: 1205 });
    await history(a.accountId, [1217, 1232, 1250]);
    const oct = await openPeriod(clerk, zoneId, "2026-10");
    const est = await runAs(clerk, () => enterEstimateAction({ periodId: oct, accountId: a.accountId, reason: "Gate locked" }));
    expect(est.ok && { consumption: est.data.consumption, type: est.data.type }).toEqual({ consumption: 15, type: "ESTIMATED" });
    expect((await runAs(clerk, () => postBillingAction({ periodId: oct }))).ok).toBe(true);
    expect((await bill(a.accountId, oct))?.currentAmount).toBe(P(325));

    setClock(() => new Date("2026-11-07T01:00:00Z"));
    const nov = await openPeriod(clerk, zoneId, "2026-11");
    const r = await read(clerk, nov, a.accountId, 1290);
    expect(r.ok && r.data.consumption).toBe(25);
    const preview = await runAs(clerk, () => previewBillingAction({ periodId: nov }));
    expect(preview.ok && preview.data.bills[0]?.currentAmount).toBe(String(P(600)));
  });

  it("A6.7 eligible senior residential: 18 m³ → basic ₱400.00, discount ₱20.00, current ₱380.00; 35 m³ → ₱925.00 with no discount", async () => {
    const s18 = await acc({ initialReading: 0, senior: true });
    const s35 = await acc({ initialReading: 0, senior: true });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    await readApproved(clerk, periodId, s18.accountId, 18);
    await readApproved(clerk, periodId, s35.accountId, 35);
    expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
    expect(await bill(s18.accountId, periodId)).toMatchObject({ basicCharge: P(400), seniorDiscount: P(20), currentAmount: P(380) });
    expect(await bill(s35.accountId, periodId)).toMatchObject({ basicCharge: P(925), seniorDiscount: 0n, currentAmount: P(925) });
  });

  it("A6.8 billing run Z1 2026-10 (member 18, non-member 35, senior member 18) → ONE JE: Dr AR 1,705.00, Dr Senior Disc 20.00 / Cr Rev–Members 800.00, Cr Rev–Non-members 925.00", async () => {
    const member = await acc({ kind: "MEMBER", initialReading: 0 });
    const non = await acc({ kind: "NON_MEMBER", initialReading: 0 });
    const senior = await acc({ kind: "MEMBER", initialReading: 0, senior: true });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    await readApproved(clerk, periodId, member.accountId, 18);
    await readApproved(clerk, periodId, non.accountId, 35);
    await readApproved(clerk, periodId, senior.accountId, 18);
    const run = await runAs(clerk, () => postBillingAction({ periodId }));
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const bills = await getDb().select().from(waterBills).where(eq(waterBills.periodId, periodId));
    expect(bills).toHaveLength(3);
    expect(new Set(bills.map((b) => b.jeId))).toEqual(new Set([run.data.jeId]));
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, run.data.jeId));
    const [ar, disc, revM, revN] = await Promise.all([acct("ar_water"), acct("senior_citizen_discounts"), acct("water_revenue_members"), acct("water_revenue_nonmembers")]);
    const net = (id: string) => lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0n);
    expect(net(ar)).toBe(P(1705));
    expect(net(disc)).toBe(P(20));
    expect(net(revM)).toBe(-P(800));
    expect(net(revN)).toBe(-P(925));
    expect(lines.filter((l) => l.accountId === ar).every((l) => l.customerId !== null)).toBe(true);
    expect(lines.every((l) => [ar, disc, revM, revN].includes(l.accountId))).toBe(true);
  });

  it('A6.9 run Z1 2026-10 again → rejected "already billed"; a run with one ACTIVE account unread → blocked, listing the account', async () => {
    const a = await acc({ initialReading: 0 });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    await readApproved(clerk, periodId, a.accountId, 18);
    expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
    expect(await runAs(clerk, () => postBillingAction({ periodId }))).toEqual({ ok: false, error: expect.stringMatching(/already billed/) });

    setClock(() => new Date("2026-11-07T01:00:00Z"));
    const b = await acc({ initialReading: 0 });
    const nov = await openPeriod(clerk, zoneId, "2026-11");
    await readApproved(clerk, nov, a.accountId, 30);
    expect(await runAs(clerk, () => postBillingAction({ periodId: nov }))).toEqual({ ok: false, error: expect.stringContaining(b.accountNo) });
  });

  it("A6.10 unpaid 2026-09 bill ₱400.00 + 2026-10 bill ₱400.00 → total due ₱800.00; GL AR increases by ₱400.00 only", async () => {
    setClock(() => new Date("2026-09-07T01:00:00Z"));
    const a = await acc({ initialReading: 0 });
    const sep = await openPeriod(clerk, zoneId, "2026-09");
    await readApproved(clerk, sep, a.accountId, 18);
    expect((await runAs(clerk, () => postBillingAction({ periodId: sep }))).ok).toBe(true);

    setClock(() => OCT_7);
    const oct = await openPeriod(clerk, zoneId, "2026-10");
    await readApproved(clerk, oct, a.accountId, 36);
    const run = await runAs(clerk, () => postBillingAction({ periodId: oct }));
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(await bill(a.accountId, oct)).toMatchObject({ currentAmount: P(400), previousBalance: P(400), totalAmountDue: P(800) });
    const ar = await acct("ar_water");
    const lines = await getDb().select().from(journalLines).where(and(eq(journalLines.jeId, run.data.jeId), eq(journalLines.accountId, ar)));
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0n)).toBe(P(400));
  });

  it("A6.11 offline sync sends the same reading twice (same client_uuid) → stored once", async () => {
    const a = await acc({ initialReading: 100 });
    expect((await runAs(clerk, () => assignReaderAction({ routeId, readerId: reader }))).ok).toBe(true);
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    const item = { clientUuid: "6f1c1a3e-2b7d-4e7a-9b1f-1a2b3c4d5e6f", periodId, accountId: a.accountId, presentReading: 118, rollover: false, remarks: null, readAt: "2026-10-03T02:00:00.000Z" };
    const first = await runAs(reader, () => syncReadingsAction({ items: [item] }));
    const second = await runAs(reader, () => syncReadingsAction({ items: [item] }));
    expect(first.ok && second.ok).toBe(true);
    const rows = await getDb().select().from(waterReadings).where(eq(waterReadings.accountId, a.accountId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientUuid: item.clientUuid, presentReading: 118, consumption: 18 });
  });

  it("A6.12 credit memo ₱50.00 approved by its preparer → Forbidden; by the manager → AR–Water −₱50.00 with a matching revenue adjustment", async () => {
    const a = await acc({ initialReading: 0 });
    const periodId = await openPeriod(clerk, zoneId, "2026-10");
    await readApproved(clerk, periodId, a.accountId, 18);
    expect((await runAs(clerk, () => postBillingAction({ periodId }))).ok).toBe(true);
    const b = await bill(a.accountId, periodId);

    const memo = await runAs(clerk, () => prepareAdjustmentAction({ billId: b!.id, kind: "CREDIT", amount: "50.00", reason: "Leak allowance" }));
    expect(memo.ok).toBe(true);
    if (!memo.ok) return;
    await expect(runAs(clerk, () => approveAdjustmentAction({ adjustmentId: memo.data.id }))).rejects.toBeInstanceOf(ForbiddenError);

    const ok = await runAs(manager, () => approveAdjustmentAction({ adjustmentId: memo.data.id }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, ok.data.jeId));
    expect(je?.status).toBe("POSTED");
    const [ar, adj] = await Promise.all([acct("ar_water"), acct("water_revenue_adjustments")]);
    const lines = await getDb().select().from(journalLines).where(and(eq(journalLines.jeId, ok.data.jeId), inArray(journalLines.accountId, [ar, adj])));
    const view = lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, customerId: l.customerId }));
    expect(view).toHaveLength(2);
    expect(view).toContainEqual({ accountId: ar, debit: 0n, credit: P(50), customerId: a.customer.id });
    expect(view).toContainEqual({ accountId: adj, debit: P(50), credit: 0n, customerId: null });
  });
});
