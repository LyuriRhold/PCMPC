import { getDb } from "@/db/client";
import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { caprWorkbook } from "@/modules/reports/cda";
import { recordRun } from "@/modules/reports/service";

/** GET /api/reports/cda?year=YYYY → the CAPR workbook (.xlsx; needs reports.cda). Each download is recorded. */
export async function GET(request: Request) {
  let userId: string;
  try {
    userId = (await requirePermission("reports.cda")).id;
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return new Response("Choose the year", { status: 400 });
  const body = await caprWorkbook(year);
  await recordRun(getDb(), { report: "CAPR", params: { year }, userId });
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="capr-data-${year}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
