import { timingSafeEqual } from "node:crypto";
import { runDailyJobs } from "@/lib/cron";
import { businessToday } from "@/lib/dates";
import "@/modules/plugins";

/**
 * GET /api/cron/daily — Vercel Cron (vercel.json) calls this once a day with
 * `Authorization: Bearer $CRON_SECRET`. Runs every registered daily job for today's Manila date;
 * a repeat call the same day skips jobs that already ran.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const date = businessToday();
  const results = await runDailyJobs(date);
  const failed = results.some((r) => r.status === "failed");
  return Response.json({ date, results }, { status: failed ? 500 : 200 });
}
