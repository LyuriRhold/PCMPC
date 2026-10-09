import { guard, noticeResponse } from "@/modules/water/pdf-routes";

/** GET /api/water/disconnections/{id}/notice → the printed disconnection notice (PDF). */
export async function GET(_request: Request, ctx: RouteContext<"/api/water/disconnections/[id]/notice">) {
  const denied = await guard(["water.disconnect", "water.reconnect", "water.bill"]);
  if (denied) return denied;
  const { id } = await ctx.params;
  return noticeResponse(id);
}
