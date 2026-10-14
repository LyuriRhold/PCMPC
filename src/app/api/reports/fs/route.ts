import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { getDb } from "@/db/client";
import { businessToday, isBusinessDate } from "@/lib/dates";
import { fsPdf, fsWorkbook } from "@/modules/accounting/export";
import { FsError } from "@/modules/accounting/statements";
import { fiscalYearStart } from "@/modules/ledger/periods";
import { getSetting } from "@/modules/settings/service";

/** GET /api/reports/fs?format=xlsx|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD → the four financial statements (needs gl.read). */
export async function GET(request: Request) {
  try {
    await requirePermission("gl.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const q = new URL(request.url).searchParams;
  const today = businessToday();
  const to = q.get("to") && isBusinessDate(q.get("to") as string) ? (q.get("to") as string) : today;
  const asked = q.get("from");
  // A missing, malformed or later-than-`to` start falls back to the fiscal year's first day (as on the page).
  const from = asked && isBusinessDate(asked) && asked <= to ? asked : await fiscalYearStart(to, getDb());
  const pdf = q.get("format") === "pdf";
  try {
    const coop = await getSetting("coop.name");
    const body = pdf ? await fsPdf({ from, to }, coop) : await fsWorkbook({ from, to }, coop);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="financial-statements-${from}-to-${to}.${pdf ? "pdf" : "xlsx"}"`,
      },
    });
  } catch (e) {
    if (e instanceof FsError) return new Response(e.message, { status: 409 });
    throw e;
  }
}
