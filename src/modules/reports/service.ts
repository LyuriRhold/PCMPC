import { desc, eq } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { users } from "@/modules/auth/schema";
import { reportRuns } from "./schema";

/** Records a generated report (who, what, with which parameters). */
export async function recordRun(db: Db | Tx, input: { report: string; params: Record<string, unknown>; userId: string }): Promise<void> {
  await db.insert(reportRuns).values({ report: input.report, params: input.params, generatedBy: input.userId, createdBy: input.userId });
}

/** The latest runs of a report, newest first. */
export async function recentRuns(report: string, limit = 10, db: Db | Tx = getDb()) {
  return db
    .select({ id: reportRuns.id, params: reportRuns.params, at: reportRuns.createdAt, username: users.username })
    .from(reportRuns)
    .leftJoin(users, eq(users.id, reportRuns.generatedBy))
    .where(eq(reportRuns.report, report))
    .orderBy(desc(reportRuns.createdAt))
    .limit(limit);
}
