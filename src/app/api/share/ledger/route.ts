import { z } from "zod";
import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { getSetting } from "@/modules/settings/service";
import { shareLedgerWorkbook } from "@/modules/share/export";

const date = z.string().refine(isBusinessDate).optional();
const params = z.object({ member: z.uuid(), from: date, to: date });

/** GET /api/share/ledger?member=<id>&from=&to= → member share ledger .xlsx (needs share.read). */
export async function GET(request: Request) {
  try {
    await requirePermission("share.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const q = Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== ""));
  const parsed = params.safeParse(q);
  if (!parsed.success) return new Response("member is required; from and to are YYYY-MM-DD", { status: 400 });
  const { member, from, to } = parsed.data;
  if (from && to && from > to) return new Response("from must not be after to", { status: 400 });
  const wb = await shareLedgerWorkbook(member, { from, to }, await getSetting("coop.name"));
  if (!wb) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(wb.body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="share-ledger-${wb.memberNo}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
