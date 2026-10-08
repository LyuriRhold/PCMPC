import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { businessToday, type BusinessDate } from "@/lib/dates";
import { numberSeries } from "@/modules/numbering/schema";

export class NumberingError extends Error {
  override name = "NumberingError";
}

const COUNTER = /\{(0+)\}/;

/**
 * Renders a series format: `{YYYY}` → year, `{YYYYMM}` → year+month, `{000…}` → the zero-padded
 * counter. `formatNumber("GJ-{YYYY}-{00000}", 7, "2026-10-07")` → `"GJ-2026-00007"`.
 */
export function formatNumber(format: string, no: number, date: BusinessDate): string {
  const match = COUNTER.exec(format);
  if (!match?.[1]) throw new NumberingError(`Format "${format}" has no {000…} counter`);
  const width = match[1].length;
  const counter = String(no);
  if (counter.length > width) throw new NumberingError(`Series ${format} overflowed ${width} digits`);
  return format
    .replace("{YYYYMM}", date.slice(0, 4) + date.slice(5, 7))
    .replace("{YYYY}", date.slice(0, 4))
    .replace(COUNTER, counter.padStart(width, "0"));
}

/** Padding = the width of the `{000…}` counter in a format. */
export function counterWidth(format: string): number {
  const match = COUNTER.exec(format);
  if (!match?.[1]) throw new NumberingError(`Format "${format}" has no {000…} counter`);
  return match[1].length;
}

/**
 * Hands out the next gapless number of series `code` for `date` (default: today in Manila).
 * Runs inside the caller's transaction and locks the series row (`SELECT … FOR UPDATE`) until
 * that transaction ends. If the transaction rolls back, the number is not consumed.
 */
export async function next(code: string, tx: Tx, date: BusinessDate = businessToday()): Promise<string> {
  const [template] = await tx
    .select()
    .from(numberSeries)
    .where(eq(numberSeries.code, code))
    .orderBy(desc(numberSeries.year))
    .limit(1);
  if (!template) throw new NumberingError(`Unknown number series "${code}"`);

  const year = template.resetsYearly ? Number(date.slice(0, 4)) : 0;
  if (template.resetsYearly && year !== template.year) {
    // First number of a new year: open that year's row, starting at 1. Concurrent callers
    // wait on the unique index, so only one row is created.
    await tx
      .insert(numberSeries)
      .values({
        code,
        prefixFormat: template.prefixFormat,
        year,
        nextNo: 1,
        padding: template.padding,
        resetsYearly: true,
      })
      .onConflictDoNothing({ target: [numberSeries.code, numberSeries.year] });
  }

  const [row] = await tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.code, code), eq(numberSeries.year, year)))
    .for("update");
  if (!row) throw new NumberingError(`Number series "${code}" has no row for ${year}`);

  await tx
    .update(numberSeries)
    .set({ nextNo: sql`${numberSeries.nextNo} + 1` })
    .where(eq(numberSeries.id, row.id));
  return formatNumber(row.prefixFormat, row.nextNo, date);
}
