import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdColumns } from "@/db/columns";
import { users } from "@/modules/auth/schema";

/** Reports generated (PHASE-16): the CDA workbooks and the report exports, who made them and when. */
export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    report: text("report").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    generatedBy: uuid("generated_by").references(() => users.id),
    /** Where the file was kept, if it was (downloads are generated on demand). */
    fileUrl: text("file_url"),
    ...createdColumns(),
  },
  (t) => [index("report_runs_report_idx").on(t.report)],
);
