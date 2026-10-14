import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { businessToday, isBusinessDate } from "@/lib/dates";
import { fsPdf, fsWorkbook } from "@/modules/accounting/export";
import { FsError } from "@/modules/accounting/statements";
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
  const from = q.get("from") && isBusinessDate(q.get("from") as string) ? (q.get("from") as string) : `${to.slice(0, 4)}-01-01`;
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
