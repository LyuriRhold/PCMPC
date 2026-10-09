import { withTx, type Tx } from "@/db/client";
import type { BusinessDate } from "@/lib/dates";
import { JobAlreadyRunError, runOnce } from "@/lib/jobs";

/**
 * Daily jobs (PHASE-07 T7.3): modules register a job here; /api/cron/daily runs every registered
 * job once per Manila business date (runOnce(job, date)), each in its own transaction, so one
 * failing job doesn't stop the others and a second run of the same day does nothing.
 */

export type DailyJob = {
  name: string;
  /** Runs inside the job's transaction; returns a small summary kept in job_runs. */
  run: (tx: Tx, date: BusinessDate) => Promise<Record<string, unknown>>;
};

const jobs = new Map<string, DailyJob>();

export function registerDailyJob(job: DailyJob): void {
  jobs.set(job.name, job);
}

export function dailyJobs(): DailyJob[] {
  return [...jobs.values()];
}

export type JobOutcome = { job: string; status: "ran" | "skipped" | "failed"; result?: Record<string, unknown>; error?: string };

export async function runDailyJobs(date: BusinessDate): Promise<JobOutcome[]> {
  const out: JobOutcome[] = [];
  for (const job of jobs.values()) {
    try {
      const result = await withTx((tx) => runOnce(tx, job.name, date, null, () => job.run(tx, date)));
      out.push({ job: job.name, status: "ran", result });
    } catch (e) {
      if (e instanceof JobAlreadyRunError) out.push({ job: job.name, status: "skipped" });
      else out.push({ job: job.name, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
