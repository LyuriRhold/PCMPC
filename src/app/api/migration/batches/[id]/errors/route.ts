import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { errorWorkbook, getBatch } from "@/modules/migration/service";

/** GET /api/migration/batches/{id}/errors → the dry-run error list (.xlsx: Row | Column | Message; needs migration.import). */
export async function GET(_request: Request, ctx: RouteContext<"/api/migration/batches/[id]/errors">) {
  try {
    await requirePermission("migration.import");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const batch = await getBatch(id);
  if (!batch) return new Response("Not found", { status: 404 });
  const name = batch.fileName.replace(/\.xlsx$/i, "").replace(/[^\w.-]+/g, "_");
  return new Response(new Uint8Array(await errorWorkbook(id)), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}-errors.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
