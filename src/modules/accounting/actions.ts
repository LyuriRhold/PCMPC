"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { format, parse as parseMoney } from "@/lib/money";
import { LedgerError } from "@/modules/ledger/service";
import { AccountingError, registerAsset, runDepreciation, voidAsset } from "./assets";
import { createBankAccount, saveRecon } from "./bank";
import { closeMonth, reopenMonth, runMissedDailyJobs, yearEndClose } from "./close";
import { FsError, mapAccount, setSegment } from "./statements";

const EXPECTED = [AccountingError, FsError, LedgerError];

/** No amount here is near this (₱10,000,000,000.00); it keeps typed amounts inside the database's range. */
const MAX_AMOUNT = 1_000_000_000_000n;

function pesos(text: string, what = "amount"): bigint {
  let value: bigint;
  try {
    value = parseMoney(text);
  } catch {
    throw new AccountingError(`Enter the ${what} in pesos, e.g. 36,000.00`);
  }
  if (value > MAX_AMOUNT || value < -MAX_AMOUNT) throw new AccountingError(`The ${what} is too large`);
  return value;
}

const date = z.string().refine(isBusinessDate, "Choose a date");
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month");

// ── Fixed assets (gl.coa: register; gl.close: depreciation) ──

const assetSchema = z.object({
  tag: z.string().trim().max(30),
  description: z.string().trim().max(200),
  classCode: z.string().trim().max(40),
  acquisitionDate: date,
  cost: z.string().trim().max(24),
  salvage: z.string().trim().max(24),
  lifeMonths: z.number().int(),
  /** Accumulated depreciation brought forward from the books before, and the month it runs through. */
  openingAccumulated: z.string().trim().max(24).optional(),
  depreciatedThrough: z.union([period, z.literal("")]).optional(),
});
/** Bookkeeper: adds an asset to the register. */
export async function registerAssetAction(input: z.input<typeof assetSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = assetSchema.parse(input);
    return ok(
      await withTx((tx) =>
        registerAsset(
          tx,
          {
            ...data,
            cost: pesos(data.cost, "cost"),
            salvage: pesos(data.salvage || "0", "salvage value"),
            openingAccumulated: pesos(data.openingAccumulated || "0", "accumulated depreciation brought forward"),
            depreciatedThrough: data.depreciatedThrough || null,
          },
          actor.id,
        ),
      ),
    );
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const voidSchema = z.object({ assetId: z.uuid(), reason: z.string().trim().max(300) });
/** Bookkeeper: voids a wrongly registered asset (only before any depreciation was posted for it). */
export async function voidAssetAction(input: z.input<typeof voidSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = voidSchema.parse(input);
    await withTx((tx) => voidAsset(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const periodSchema = z.object({ period });
/** Bookkeeper: the month's depreciation run (once per month). */
export async function runDepreciationAction(input: z.input<typeof periodSchema>): Promise<ActionResult<{ total: string; assets: number }>> {
  const actor = await requirePermission("gl.close");
  try {
    const data = periodSchema.parse(input);
    const r = await withTx((tx) => runDepreciation(tx, data, actor.id));
    return ok({ total: format(r.total), assets: r.assets });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Bank reconciliation (gl.coa: bank accounts; gl.jv_prepare: reconciliations) ──

const bankSchema = z.object({ name: z.string().trim().max(80), bankName: z.string().trim().max(80), accountNo: z.string().trim().max(40), glAccountId: z.uuid() });
/** Bookkeeper: a bank account and its cash GL account. */
export async function createBankAccountAction(input: z.input<typeof bankSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = bankSchema.parse(input);
    return ok(await withTx((tx) => createBankAccount(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const reconSchema = z.object({
  bankAccountId: z.uuid(),
  period,
  bankBalance: z.string().trim().max(24),
  clearedLineIds: z.array(z.uuid()).max(5000),
  bankItems: z.array(z.object({ date, description: z.string().trim().max(120), amount: z.string().trim().max(24) })).max(200),
});
/** Bookkeeper: saves a month's bank reconciliation (it must balance). */
export async function saveReconAction(input: z.input<typeof reconSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.jv_prepare");
  try {
    const data = reconSchema.parse(input);
    const r = await withTx((tx) =>
      saveRecon(tx, { ...data, bankBalance: pesos(data.bankBalance, "statement balance"), bankItems: data.bankItems.map((i) => ({ ...i, amount: pesos(i.amount, "bank-only amount") })) }, actor.id),
    );
    return ok({ id: r.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Period close (gl.close; reopening: gl.reopen) ──

const monthSchema = z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12) });
/** Bookkeeper: closes a month whose checklist passes (posting into it is then refused). */
export async function closeMonthAction(input: z.input<typeof monthSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("gl.close");
  try {
    const data = monthSchema.parse(input);
    await withTx((tx) => closeMonth(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Bookkeeper: runs the daily jobs a month missed (past dates, oldest first), so its checklist can pass. */
export async function runMissedJobsAction(input: z.input<typeof monthSchema>): Promise<ActionResult<{ dates: number }>> {
  const actor = await requirePermission("gl.close");
  try {
    const data = monthSchema.parse(input);
    return ok(await runMissedDailyJobs(data, actor.id));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const reopenSchema = monthSchema.extend({ reason: z.string().trim().max(300) });
/** Administrator: reopens a closed month with a reason (audited). */
export async function reopenMonthAction(input: z.input<typeof reopenSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("gl.reopen");
  try {
    const data = reopenSchema.parse(input);
    await withTx((tx) => reopenMonth(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const yearSchema = z.object({ year: z.number().int().min(2000).max(2200) });
/** Bookkeeper: the year-end close (closing entry, last month and the year closed, next year opened). */
export async function yearEndCloseAction(input: z.input<typeof yearSchema>): Promise<ActionResult<{ netSurplus: string }>> {
  const actor = await requirePermission("gl.close");
  try {
    const data = yearSchema.parse(input);
    const r = await withTx((tx) => yearEndClose(tx, data, actor.id));
    return ok({ netSurplus: format(r.netSurplus) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Statement mapping (gl.coa) ──

const mapSchema = z.object({ accountId: z.uuid(), fsLineId: z.uuid() });
/** Bookkeeper: puts an account on a statement line (assets, liabilities and equity on the Financial Condition; revenues and expenses on Operations). */
export async function mapAccountAction(input: z.input<typeof mapSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = mapSchema.parse(input);
    await withTx((tx) => mapAccount(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const segmentSchema = z.object({ accountId: z.uuid(), segmentCode: z.string().trim().max(20) });
/** Bookkeeper: the business segment of a revenue or expense account. */
export async function setSegmentAction(input: z.input<typeof segmentSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = segmentSchema.parse(input);
    await withTx((tx) => setSegment(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
