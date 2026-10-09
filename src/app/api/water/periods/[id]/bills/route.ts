import { connection } from "next/server";
import { billsResponse, guard } from "@/modules/water/pdf-routes";

/** GET /api/water/periods/{id}/bills[?route={routeId}] → the period's bills, in route order, as one PDF. */
export async function GET(request: Request, ctx: RouteContext<"/api/water/periods/[id]/bills">) {
  await connection();
  const denied = await guard(["water.bill", "water.review_readings", "water.adjust_prepare", "water.adjust_approve"]);
  if (denied) return denied;
  const { id } = await ctx.params;
  return billsResponse(id, new URL(request.url).searchParams.get("route"));
}
