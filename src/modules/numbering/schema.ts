import { boolean, check, integer, pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdColumns } from "@/db/columns";

/**
 * Gapless document-number series. One row per (code, year); `year` is 0 for series that never reset.
 * `next_no` is the number the next call will hand out.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    prefixFormat: text("prefix_format").notNull(),
    year: integer("year").notNull().default(0),
    nextNo: integer("next_no").notNull().default(1),
    padding: integer("padding").notNull(),
    resetsYearly: boolean("resets_yearly").notNull(),
    ...createdColumns(),
  },
  (t) => [
    unique("number_series_code_year_uq").on(t.code, t.year),
    check("number_series_next_no_positive", sql`${t.nextNo} >= 1`),
    check("number_series_year_matches_reset", sql`(${t.resetsYearly} AND ${t.year} > 0) OR (NOT ${t.resetsYearly} AND ${t.year} = 0)`),
  ],
);
