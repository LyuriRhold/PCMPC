"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { audit } from "@/lib/audit";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { runDailyJobs } from "@/lib/cron";
import { businessToday, isBusinessDate } from "@/lib/dates";
import { LedgerError } from "@/modules/ledger/service";
import { cancelNotice, disconnect, issueNotice, reconnect } from "./collections";
import { addProductionReading } from "./reports";
import { WaterError } from "./service";

const EXPECTED = [WaterError, LedgerError];
const reading = z.number().int().min(0).max(999_999_999);

const accountSchema = z.object({ accountId: z.uuid() });
export async function issueNoticeAction(input: z.input<typeof accountSchema>): Promise<ActionResult<{ id: string; noticeNo: string }>> {
  const actor = await requirePermission("water.disconnect");
  try {
    const { accountId } = accountSchema.parse(input);
    const n = await withTx((tx) => issueNotice(tx, accountId, actor.id));
    return ok({ id: n.id, noticeNo: n.noticeNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const orderSchema = z.object({ disconnectionId: z.uuid(), reading });
export async function disconnectAction(input: z.input<typeof orderSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.disconnect");
  try {
    const data = orderSchema.parse(input);
    await withTx((tx) => disconnect(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

export async function reconnectAction(input: z.input<typeof orderSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.reconnect");
  try {
    const data = orderSchema.parse(input);
    await withTx((tx) => reconnect(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelSchema = z.object({ disconnectionId: z.uuid(), reason: z.string().trim().min(1, "A reason is required").max(300) });
export async function cancelNoticeAction(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.disconnect");
  try {
    const data = cancelSchema.parse(input);
    await withTx((tx) => cancelNotice(tx, data.disconnectionId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const productionSchema = z.object({
  source: z.string().trim().min(1, "Name the source meter").max(60),
  readingDate: z.string().refine(isBusinessDate, "Enter a valid date"),
  reading: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export async function addProductionReadingAction(input: z.input<typeof productionSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.bill");
  try {
    const data = productionSchema.parse(input);
    await withTx((tx) => addProductionReading(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Runs today's daily jobs now (e.g. when the server's cron is off); a job that already ran today is skipped. */
export async function runDailyJobsAction(): Promise<ActionResult<Array<{ job: string; status: string; detail: string }>>> {
  const actor = await requirePermission("water.bill");
  const date = businessToday();
  const results = await runDailyJobs(date);
  await withTx((tx) => audit(tx, { action: "cron.run_manual", entity: "job_runs", entityId: date, after: { results: results.map((r) => `${r.job}: ${r.status}`) }, userId: actor.id }));
  return ok(results.map((r) => ({ job: r.job, status: r.status, detail: r.error ?? (r.result ? JSON.stringify(r.result) : "") })));
}
