import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { MIGRATION_ENTITIES, templateFileName, templateWorkbook, type MigrationEntity } from "@/modules/migration/templates";

/** GET /api/migration/templates/{entity} → the blank Excel template (needs migration.import). */
export async function GET(_request: Request, ctx: RouteContext<"/api/migration/templates/[entity]">) {
  try {
    await requirePermission("migration.import");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const { entity } = await ctx.params;
  if (!(MIGRATION_ENTITIES as readonly string[]).includes(entity)) return new Response("Unknown template", { status: 404 });
  const body = await templateWorkbook(entity as MigrationEntity);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${templateFileName(entity as MigrationEntity)}"`,
      "cache-control": "private, no-store",
    },
  });
}
