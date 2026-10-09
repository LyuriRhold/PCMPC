import { connection } from "next/server";
import { billResponse, guard } from "@/modules/water/pdf-routes";

/** GET /api/water/bills/{id}/pdf → one bill as a PDF. */
export async function GET(_request: Request, ctx: RouteContext<"/api/water/bills/[id]/pdf">) {
  await connection();
  const denied = await guard(["water.bill", "water.review_readings", "water.adjust_prepare", "water.adjust_approve", "cash.receipt"]);
  if (denied) return denied;
  const { id } = await ctx.params;
  return billResponse(id);
}
