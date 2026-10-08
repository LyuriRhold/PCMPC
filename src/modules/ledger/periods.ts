import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { addMonths, businessToday, monthEnd, type BusinessDate } from "@/lib/dates";
import { getSetting } from "@/modules/settings/service";
import { fiscalYears, periods } from "./schema";

/** "2026-09" style label for a business date's period. */
export function periodKey(date: BusinessDate): string {
  return date.slice(0, 7);
}

/**
 * Creates fiscal year `year` and its 12 monthly periods (all OPEN) if they don't exist. A fiscal
 * year is named by the calendar year it starts in; it starts on `fiscal.year_start_month`.
 */
export async function ensureFiscalYear(tx: Tx, year: number): Promise<void> {
  const startMonth = await getSetting("fiscal.year_start_month", tx);
  const startDate = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = monthEnd(addMonths(startDate, 11));
  await tx.insert(fiscalYears).values({ year, startDate, endDate }).onConflictDoNothing({ target: fiscalYears.year });
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.year, year));
  if (!fy) throw new Error(`fiscal year ${year} was not created`);
  for (let i = 0; i < 12; i++) {
    const d = addMonths(startDate, i);
    await tx
      .insert(periods)
      .values({ fiscalYearId: fy.id, year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) })
      .onConflictDoNothing({ target: [periods.year, periods.month] });
  }
}

/** Seed step: the fiscal year containing today's business date. */
export async function seedCurrentFiscalYear(tx: Tx): Promise<void> {
  const today = businessToday();
  const startMonth = await getSetting("fiscal.year_start_month", tx);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  await ensureFiscalYear(tx, month >= startMonth ? year : year - 1);
}

/** The period row for a business date, or null if no fiscal year covers it. */
export async function periodOf(date: BusinessDate, db: Db | Tx) {
  const [p] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.year, Number(date.slice(0, 4))), eq(periods.month, Number(date.slice(5, 7)))));
  return p ?? null;
}
