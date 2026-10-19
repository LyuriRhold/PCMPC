import { getDb } from "@/db/client";
import { can, ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { formatDate, isBusinessDate } from "@/lib/dates";
import { reportWorkbook } from "@/modules/reports/export";
import { reportDef, runReport } from "@/modules/reports/operational";
import { recordRun } from "@/modules/reports/service";
import { getSetting } from "@/modules/settings/service";

/** GET /api/reports/operational/{key}?from=&to=&asOf= → the report as .xlsx (needs reports.read; contacts masked unless reports.contacts). */
export async function GET(request: Request, ctx: RouteContext<"/api/reports/operational/[key]">) {
  let user;
  try {
    user = await requirePermission("reports.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const { key } = await ctx.params;
  const def = reportDef(key);
  if (!def) return new Response("Report not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const date = (name: string) => {
    const v = q.get(name);
    return v && isBusinessDate(v) ? v : undefined;
  };
  const params = { from: date("from"), to: date("to"), asOf: date("asOf") };
  if (params.from && params.to && params.from > params.to) return new Response("The period starts on or before it ends", { status: 400 });
  const result = await runReport(key, params, { canSeeSensitive: can(user, "reports.contacts") });
  const subtitle = def.params === "range" ? `${formatDate(params.from ?? "")} to ${formatDate(params.to ?? "")}` : def.params === "asOf" ? `As of ${formatDate(params.asOf ?? "")}` : "";
  const body = await reportWorkbook(result, await getSetting("coop.name"), params.from || params.asOf ? subtitle : "");
  await recordRun(getDb(), { report: key, params: { ...params }, userId: user.id });
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${key}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
