import { z } from "zod";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth-guard";
import { members } from "@/modules/members/schema";
import { memberSoa } from "@/modules/reports/soa";
import { soaPdf } from "@/modules/reports/soa-pdf";
import { getSetting } from "@/modules/settings/service";
import { guard } from "@/modules/water/pdf-routes";
import { eq } from "drizzle-orm";
import { recordRun } from "@/modules/reports/service";

/** GET /api/reports/statements/{memberId} → the member statement of account as a PDF (members.read or reports.read). */
export async function GET(_request: Request, ctx: RouteContext<"/api/reports/statements/[memberId]">) {
  const denied = await guard(["members.read", "reports.read"]);
  if (denied) return denied;
  const { memberId } = await ctx.params;
  if (!z.uuid().safeParse(memberId).success) return new Response("Member not found", { status: 404 });
  const [m] = await getDb().select({ id: members.id }).from(members).where(eq(members.id, memberId));
  if (!m) return new Response("Member not found", { status: 404 });
  const soa = await memberSoa(memberId);
  const body = await soaPdf(soa, await getSetting("coop.name"));
  const user = await getCurrentUser();
  if (user) await recordRun(getDb(), { report: "member-soa", params: { memberId, memberNo: soa.member.memberNo }, userId: user.id });
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="soa-${soa.member.memberNo ?? memberId}.pdf"`, "cache-control": "private, no-store" },
  });
}
