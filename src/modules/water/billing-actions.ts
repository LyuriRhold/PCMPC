"use server";

import "@/modules/plugins";
import { z } from "zod";
import { getDb, withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { JobAlreadyRunError } from "@/lib/jobs";
import { parse as parseMoney } from "@/lib/money";
import { LedgerError } from "@/modules/ledger/service";
import { approveAdjustment, closeAccount, postRun, prepareAdjustment, previewRun, rejectAdjustment } from "./billing";
import { ConsumptionError } from "./consumption";
import { RateError } from "./rates";
import {
  approveReading,
  assignReader,
  closePeriod,
  enterEstimate,
  enterReading,
  excludeAccount,
  openPeriod,
  readerCanRead,
  rejectReading,
} from "./readings";
import type { WaterReading } from "./schema";
import { addRoute, addZone, customerName, WaterError } from "./service";

const EXPECTED = [WaterError, RateError, ConsumptionError, JobAlreadyRunError, LedgerError];
const businessDate = z.string().refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)");
const reading = z.number().int().min(0).max(999_999_999);
const reason = z.string().trim().min(1, "A reason is required").max(300);

export type ReadingView = Pick<WaterReading, "id" | "accountId" | "previousReading" | "presentReading" | "consumption" | "type" | "flags" | "status" | "rollover">;
const view = (r: WaterReading): ReadingView => ({
  id: r.id,
  accountId: r.accountId,
  previousReading: r.previousReading,
  presentReading: r.presentReading,
  consumption: r.consumption,
  type: r.type,
  flags: r.flags,
  status: r.status,
  rollover: r.rollover,
});

// ── Zones, routes, readers ──

const zoneSchema = z.object({ code: z.string().trim().max(20), name: z.string().trim().max(100) });
export async function addZoneAction(input: z.input<typeof zoneSchema>): Promise<ActionResult<{ id: number }>> {
  const actor = await requirePermission("water.customers");
  try {
    const data = zoneSchema.parse(input);
    const zone = await withTx((tx) => addZone(tx, data, actor.id));
    return ok({ id: zone.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const routeSchema = z.object({ zoneId: z.number().int().positive(), code: z.string().trim().max(20), name: z.string().trim().max(100) });
export async function addRouteAction(input: z.input<typeof routeSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("water.customers");
  try {
    const data = routeSchema.parse(input);
    const route = await withTx((tx) => addRoute(tx, data, actor.id));
    return ok({ id: route.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const readerSchema = z.object({ routeId: z.uuid(), readerId: z.uuid().nullable() });
export async function assignReaderAction(input: z.input<typeof readerSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.customers");
  try {
    const data = readerSchema.parse(input);
    await withTx((tx) => assignReader(tx, data.routeId, data.readerId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Periods ──

const periodSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "The period must look like 2026-10"),
  zoneId: z.number().int().positive(),
  readingFrom: businessDate,
  readingTo: businessDate,
  billDate: businessDate,
});
export async function openPeriodAction(input: z.input<typeof periodSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("water.bill");
  try {
    const data = periodSchema.parse(input);
    const p = await withTx((tx) => openPeriod(tx, data, actor.id));
    return ok({ id: p.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const periodIdSchema = z.object({ periodId: z.uuid() });
export async function closePeriodAction(input: z.input<typeof periodIdSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.bill");
  try {
    const { periodId } = periodIdSchema.parse(input);
    await withTx((tx) => closePeriod(tx, periodId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Readings ──

const readingSchema = z.object({
  periodId: z.uuid(),
  accountId: z.uuid(),
  presentReading: reading,
  rollover: z.boolean(),
  remarks: z.string().trim().max(300).nullable(),
});
/** Office reading entry (grid). Replaces an unbilled reading of the same period. */
export async function enterReadingAction(input: z.input<typeof readingSchema>): Promise<ActionResult<ReadingView>> {
  const actor = await requirePermission("water.bill");
  try {
    const data = readingSchema.parse(input);
    const r = await withTx((tx) => enterReading(tx, data, actor.id, "OFFICE"));
    return ok(view(r));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const estimateSchema = z.object({ periodId: z.uuid(), accountId: z.uuid(), reason, consumption: z.number().int().min(0).max(100_000).nullable().optional() });
export async function enterEstimateAction(input: z.input<typeof estimateSchema>): Promise<ActionResult<ReadingView>> {
  const actor = await requirePermission("water.review_readings");
  try {
    const data = estimateSchema.parse(input);
    const r = await withTx((tx) => enterEstimate(tx, data, actor.id));
    return ok(view(r));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const readingIdSchema = z.object({ readingId: z.uuid() });
export async function approveReadingAction(input: z.input<typeof readingIdSchema>): Promise<ActionResult<ReadingView>> {
  const actor = await requirePermission("water.review_readings");
  try {
    const { readingId } = readingIdSchema.parse(input);
    const r = await withTx((tx) => approveReading(tx, readingId, actor.id));
    return ok(view(r));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const rejectReadingSchema = z.object({ readingId: z.uuid(), reason });
export async function rejectReadingAction(input: z.input<typeof rejectReadingSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.review_readings");
  try {
    const data = rejectReadingSchema.parse(input);
    await withTx((tx) => rejectReading(tx, data.readingId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const excludeSchema = z.object({ periodId: z.uuid(), accountId: z.uuid(), reason });
export async function excludeAccountAction(input: z.input<typeof excludeSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.review_readings");
  try {
    const data = excludeSchema.parse(input);
    await withTx((tx) => excludeAccount(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const syncSchema = z.object({
  items: z
    .array(
      z.object({
        clientUuid: z.uuid(),
        periodId: z.uuid(),
        accountId: z.uuid(),
        presentReading: reading,
        rollover: z.boolean(),
        remarks: z.string().trim().max(300).nullable(),
        readAt: z.iso.datetime(),
      }),
    )
    .max(500),
});
export type SyncResult = { clientUuid: string; status: "saved" | "duplicate" | "error"; error?: string; reading?: ReadingView };

/**
 * Mobile reading sync (offline queue). Idempotent: an item already stored (same client uuid, or
 * the same period + account) comes back as "duplicate". Each item is saved on its own, so one bad
 * reading doesn't hold back the rest. Readers can only read accounts on their assigned routes.
 */
export async function syncReadingsAction(input: z.input<typeof syncSchema>): Promise<ActionResult<SyncResult[]>> {
  const actor = await requirePermission("water.read_meter");
  try {
    const { items } = syncSchema.parse(input);
    const results: SyncResult[] = [];
    for (const item of items) {
      try {
        if (!(await readerCanRead(getDb(), actor.id, item.accountId))) throw new WaterError("This account isn't on your assigned routes");
        const r = await withTx((tx) => enterReading(tx, { ...item, readAt: new Date(item.readAt) }, actor.id, "MOBILE"));
        results.push({ clientUuid: item.clientUuid, status: r.duplicate ? "duplicate" : "saved", reading: view(r) });
      } catch (e) {
        const f = failFrom(e, EXPECTED);
        if (!f.ok) results.push({ clientUuid: item.clientUuid, status: "error", error: f.error });
      }
    }
    return ok(results);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Billing runs ──

export type BillPreview = {
  accountId: string;
  accountNo: string;
  customerName: string;
  customerType: string;
  consumption: number;
  basicCharge: string;
  seniorDiscount: string;
  advanceApplied: string;
  currentAmount: string;
  previousBalance: string;
  totalAmountDue: string;
};

export async function previewBillingAction(input: z.input<typeof periodIdSchema>): Promise<ActionResult<{ bills: BillPreview[]; blockers: Array<{ accountNo: string; problem: string }> }>> {
  await requirePermission("water.bill");
  try {
    const { periodId } = periodIdSchema.parse(input);
    const { bills, blockers } = await previewRun(periodId);
    return ok({
      bills: bills.map((b) => ({
        accountId: b.account.id,
        accountNo: b.account.accountNo,
        customerName: customerName(b.customer),
        customerType: b.customer.type,
        consumption: b.consumption,
        basicCharge: String(b.basicCharge),
        seniorDiscount: String(b.seniorDiscount),
        advanceApplied: String(b.advanceApplied),
        currentAmount: String(b.currentAmount),
        previousBalance: String(b.previousBalance),
        totalAmountDue: String(b.totalAmountDue),
      })),
      blockers: blockers.map((b) => ({ accountNo: b.accountNo, problem: b.problem })),
    });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

export async function postBillingAction(input: z.input<typeof periodIdSchema>): Promise<ActionResult<{ bills: number; jeId: string; total: string }>> {
  const actor = await requirePermission("water.bill");
  try {
    const { periodId } = periodIdSchema.parse(input);
    return ok(await withTx((tx) => postRun(tx, periodId, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Credit / debit memos ──

const adjustmentSchema = z.object({ billId: z.uuid(), kind: z.enum(["CREDIT", "DEBIT"]), amount: z.string().trim().max(20), reason });
export async function prepareAdjustmentAction(input: z.input<typeof adjustmentSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("water.adjust_prepare");
  try {
    const data = adjustmentSchema.parse(input);
    let amount: bigint;
    try {
      amount = parseMoney(data.amount);
    } catch {
      throw new WaterError("Enter a valid amount (e.g. 50.00)");
    }
    const row = await withTx((tx) => prepareAdjustment(tx, { ...data, amount }, actor.id));
    return ok({ id: row.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const adjustmentIdSchema = z.object({ adjustmentId: z.uuid() });
/** Approves and posts a memo; throws (not returns) when the approver prepared it (SoD). */
export async function approveAdjustmentAction(input: z.input<typeof adjustmentIdSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("water.adjust_approve");
  try {
    const { adjustmentId } = adjustmentIdSchema.parse(input);
    return ok(await withTx((tx) => approveAdjustment(tx, adjustmentId, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const rejectAdjustmentSchema = z.object({ adjustmentId: z.uuid(), reason });
export async function rejectAdjustmentAction(input: z.input<typeof rejectAdjustmentSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.adjust_approve");
  try {
    const data = rejectAdjustmentSchema.parse(input);
    await withTx((tx) => rejectAdjustment(tx, data.adjustmentId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Closure ──

const closeSchema = z.object({ accountId: z.uuid(), finalReading: reading, rollover: z.boolean(), reason });
export type SettlementView = { deposit: string; unpaid: string; offset: string; refund: string; offsetJeId: string | null; dvId: string | null };

/** Closes the account: final bill, then the deposit settles (offset unpaid, refund the rest by DV). */
export async function closeAccountAction(input: z.input<typeof closeSchema>): Promise<ActionResult<{ billId: string; billNo: string; settlement: SettlementView }>> {
  const actor = await requirePermission("water.disconnect");
  try {
    const data = closeSchema.parse(input);
    const r = await withTx((tx) => closeAccount(tx, data, actor.id));
    const s = r.settlement;
    const settlement: SettlementView = s
      ? { deposit: String(s.deposit), unpaid: String(s.unpaid), offset: String(s.offset), refund: String(s.refund), offsetJeId: s.offsetJeId, dvId: s.dvId }
      : { deposit: "0", unpaid: "0", offset: "0", refund: "0", offsetJeId: null, dvId: null };
    return ok({ billId: r.billId, billNo: r.billNo, settlement });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
