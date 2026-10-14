import { and, eq, sql } from "drizzle-orm";
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

/** The fiscal year a business date falls in (named by the calendar year it starts in). */
export async function fiscalYearOf(date: BusinessDate, db: Db | Tx): Promise<number> {
  const startMonth = await getSetting("fiscal.year_start_month", db);
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= startMonth ? year : year - 1;
}

/** The first day of the fiscal year a business date falls in. */
export async function fiscalYearStart(date: BusinessDate, db: Db | Tx): Promise<BusinessDate> {
  const startMonth = await getSetting("fiscal.year_start_month", db);
  return `${await fiscalYearOf(date, db)}-${String(startMonth).padStart(2, "0")}-01`;
}

/** Seed step: the fiscal year containing today's business date. */
export async function seedCurrentFiscalYear(tx: Tx): Promise<void> {
  await ensureFiscalYear(tx, await fiscalYearOf(businessToday(), tx));
}

/**
 * Opens the fiscal year a date falls in when it is the year right after the latest one set up and
 * it has started, so January's postings don't wait for the old year's year-end close. Returns
 * whether the year was opened.
 */
export async function openNextFiscalYear(tx: Tx, date: BusinessDate): Promise<boolean> {
  const year = await fiscalYearOf(date, tx);
  const [latest] = await tx.select({ year: sql<number | null>`max(${fiscalYears.year})` }).from(fiscalYears);
  if (latest?.year == null || year !== latest.year + 1) return false;
  if ((await fiscalYearStart(date, tx)) > businessToday()) return false;
  await ensureFiscalYear(tx, year);
  return true;
}

/** The period row for a business date, or null if no fiscal year covers it. */
export async function periodOf(date: BusinessDate, db: Db | Tx) {
  const [p] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.year, Number(date.slice(0, 4))), eq(periods.month, Number(date.slice(5, 7)))));
  return p ?? null;
}

/**
 * The period row for posting into, held FOR SHARE until the transaction ends: closing the month
 * (FOR UPDATE) waits for entries being posted into it, and a posting waits for a close under way.
 */
export async function periodForPosting(date: BusinessDate, tx: Tx) {
  const [p] = await tx
    .select()
    .from(periods)
    .where(and(eq(periods.year, Number(date.slice(0, 4))), eq(periods.month, Number(date.slice(5, 7)))))
    .for("share");
  return p ?? null;
}
