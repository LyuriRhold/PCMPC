import { connection } from "next/server";
import { guard, readingSheetResponse } from "@/modules/water/pdf-routes";

/** GET /api/water/periods/{id}/sheet?route={routeId} → reading sheet PDF of one route. */
export async function GET(request: Request, ctx: RouteContext<"/api/water/periods/[id]/sheet">) {
  await connection();
  const denied = await guard(["water.bill", "water.review_readings", "water.read_meter"]);
  if (denied) return denied;
  const { id } = await ctx.params;
  return readingSheetResponse(id, new URL(request.url).searchParams.get("route"));
}
