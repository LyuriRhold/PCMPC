import { z } from "zod";
import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { generalLedgerWorkbook } from "@/modules/ledger/export";
import { getSetting } from "@/modules/settings/service";

const params = z.object({
  account: z.uuid(),
  from: z.string().refine(isBusinessDate),
  to: z.string().refine(isBusinessDate),
});

/** GET /api/reports/general-ledger?account=<id>&from=&to= → .xlsx (needs gl.read). */
export async function GET(request: Request) {
  try {
    await requirePermission("gl.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const parsed = params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("account, from and to are required", { status: 400 });
  const { account, from, to } = parsed.data;
  const body = await generalLedgerWorkbook(account, from, to, await getSetting("coop.name"));
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="general-ledger-${from}-to-${to}.xlsx"`,
    },
  });
}
