"use server";

import "@/modules/plugins";
import { z } from "zod";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { can, requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { reportDef, runReport, type ReportResult } from "./operational";

const date = z.string().refine(isBusinessDate, "Choose a date");
const runSchema = z.object({
  key: z.string().max(40),
  params: z.object({ from: date.optional(), to: date.optional(), asOf: date.optional() }).default({}),
});

/**
 * Runs an operational report (reports.read: management, the board, the auditor…). Members'
 * contact numbers are masked unless the viewer holds members.read_sensitive.
 */
export async function runReportAction(input: z.input<typeof runSchema>): Promise<ActionResult<ReportResult>> {
  const user = await requirePermission("reports.read");
  try {
    const data = runSchema.parse(input);
    if (!reportDef(data.key)) return { ok: false, error: "Choose a report" };
    if (data.params.from && data.params.to && data.params.from > data.params.to) return { ok: false, error: "The period starts on or before it ends" };
    return ok(await runReport(data.key, data.params, { canSeeSensitive: can(user, "members.read_sensitive") }));
  } catch (e) {
    return failFrom(e, []);
  }
}
