import { z } from "zod";
import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { getSetting } from "@/modules/settings/service";
import { SurplusError } from "@/modules/surplus/engine";
import { surplusWorkbook } from "@/modules/surplus/export";
import { getAllocation } from "@/modules/surplus/service";

/** GET /api/reports/surplus/{allocationId} → the allocation summary and the per-member ISC/PR list (.xlsx; needs gl.read). */
export async function GET(_request: Request, ctx: RouteContext<"/api/reports/surplus/[id]">) {
  try {
    await requirePermission("gl.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const { id } = await ctx.params;
  const allocation = z.uuid().safeParse(id).success ? await getAllocation(id) : null;
  if (!allocation) return new Response("Allocation not found", { status: 404 });
  try {
    const body = await surplusWorkbook(allocation.id, await getSetting("coop.name"));
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="net-surplus-allocation-${allocation.fiscalYear}.xlsx"`,
      },
    });
  } catch (e) {
    if (e instanceof SurplusError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
