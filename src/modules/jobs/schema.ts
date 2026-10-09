import { jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";

/**
 * One row per completed run of an idempotent job (PLAN §5 rule 8): billing runs, interest runs,
 * cron jobs. The unique (job, key) is what makes a second run of the same key impossible.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    key: text("key").notNull(),
    runAt: tstz("run_at").notNull(),
    by: uuid("by").references(() => users.id),
    result: jsonb("result").$type<Record<string, unknown>>(),
    ...createdColumns(),
  },
  (t) => [unique("job_runs_job_key_uq").on(t.job, t.key)],
);

export type JobRun = typeof jobRuns.$inferSelect;
