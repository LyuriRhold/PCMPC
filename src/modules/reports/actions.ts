"use server";

import "@/modules/plugins";
import { z } from "zod";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { can, requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { reportDef, runReport, type Cell, type ReportColumn, type ReportResult } from "./operational";

type ViewCell = string | number | null;
/** A report as the browser gets it: plain JSON, amounts formatted ("₱1,234.56"). */
export type ReportView = {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, ViewCell>>;
  totals: Record<string, ViewCell> | null;
  reconciliation: Array<{ label: string; gl: string; subsidiary: string; difference: string; agrees: boolean }>;
};

const cell = (v: Cell): ViewCell => (typeof v === "bigint" ? format(v) : v);
const plain = (row: Record<string, Cell>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)]));

function toView(r: ReportResult): ReportView {
  return {
    title: r.title,
    columns: r.columns,
    rows: r.rows.map(plain),
    totals: r.totals ? plain(r.totals) : null,
    reconciliation: r.reconciliation.map((x) => ({ label: x.label, gl: format(x.gl), subsidiary: format(x.subsidiary), difference: format(x.difference), agrees: x.difference === 0n })),
  };
}

const date = z.string().refine(isBusinessDate, "Choose a date");
const runSchema = z.object({
  key: z.string().max(40),
  params: z.object({ from: date.optional(), to: date.optional(), asOf: date.optional() }).default({}),
});

/**
 * Runs an operational report (reports.read: management, the board, the auditor…). Members'
 * contact numbers are masked unless the viewer holds members.read_sensitive.
 */
export async function runReportAction(input: z.input<typeof runSchema>): Promise<ActionResult<ReportView>> {
  const user = await requirePermission("reports.read");
  try {
    const data = runSchema.parse(input);
    if (!reportDef(data.key)) return { ok: false, error: "Choose a report" };
    if (data.params.from && data.params.to && data.params.from > data.params.to) return { ok: false, error: "The period starts on or before it ends" };
    return ok(toView(await runReport(data.key, data.params, { canSeeSensitive: can(user, "members.read_sensitive") })));
  } catch (e) {
    return failFrom(e, []);
  }
}
