import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { now } from "@/lib/dates";
import { jobRuns } from "@/modules/jobs/schema";

/** The job already ran for this key; the message is safe to show. */
export class JobAlreadyRunError extends Error {
  override name = "JobAlreadyRunError";
}

/**
 * Runs `fn` once per (job, key), inside the caller's transaction. The job_runs row is claimed
 * first (a concurrent second run waits on the unique index, then sees the row and stops), and
 * it rolls back with everything else if `fn` throws, so a failed run can be retried.
 */
export async function runOnce<T extends Record<string, unknown>>(
  tx: Tx,
  job: string,
  key: string,
  actorId: string | null,
  fn: () => Promise<T>,
  alreadyRun: (key: string) => string = (k) => `${job} ${k} has already run`,
): Promise<T> {
  const [claimed] = await tx
    .insert(jobRuns)
    .values({ job, key, runAt: now(), by: actorId, createdBy: actorId })
    .onConflictDoNothing({ target: [jobRuns.job, jobRuns.key] })
    .returning({ id: jobRuns.id });
  if (!claimed) throw new JobAlreadyRunError(alreadyRun(key));
  const result = await fn();
  await tx.update(jobRuns).set({ result: JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) }).where(eq(jobRuns.id, claimed.id));
  return result;
}

/** Whether (job, key) has already run. */
export async function hasRun(db: Db | Tx, job: string, key: string): Promise<boolean> {
  const [r] = await db.select({ id: jobRuns.id }).from(jobRuns).where(and(eq(jobRuns.job, job), eq(jobRuns.key, key)));
  return !!r;
}
