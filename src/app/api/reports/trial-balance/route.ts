import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { businessToday, isBusinessDate } from "@/lib/dates";
import { trialBalanceWorkbook } from "@/modules/ledger/export";
import { getSetting } from "@/modules/settings/service";

/** GET /api/reports/trial-balance?asOf=YYYY-MM-DD → .xlsx (needs gl.read). */
export async function GET(request: Request) {
  try {
    await requirePermission("gl.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const asOfParam = new URL(request.url).searchParams.get("asOf");
  const asOf = asOfParam && isBusinessDate(asOfParam) ? asOfParam : businessToday();
  const body = await trialBalanceWorkbook(asOf, await getSetting("coop.name"));
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="trial-balance-${asOf}.xlsx"`,
    },
  });
}
