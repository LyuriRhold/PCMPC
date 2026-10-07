import { TZDate } from "@date-fns/tz";
import { format as formatFns } from "date-fns";

/**
 * Business dates. The coop runs on Manila time (APP_TZ, default Asia/Manila) while servers
 * (Vercel) run on UTC, so a business date is never derived from `new Date()` directly: it
 * always comes from `businessToday()`.
 *
 * A business date is a plain calendar date string `YYYY-MM-DD` with no time and no zone.
 * Arithmetic on it is pure calendar math, so it never shifts across time zones.
 */
export type BusinessDate = string;

/** Returns the current instant. Injected in tests and jobs to pin "now". */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

let activeClock: Clock = systemClock;

/**
 * Replaces the clock used when `businessToday()` is called without an argument
 * (tests, back-dated jobs). Pass `null` to restore the system clock.
 */
export function setClock(clock: Clock | null): void {
  activeClock = clock ?? systemClock;
}

export function businessTimeZone(): string {
  return process.env.APP_TZ || "Asia/Manila";
}

/** Today's date in the business time zone: at 2026-10-06T16:30:00Z it is `"2026-10-07"` in Manila. */
export function businessToday(now?: Date | Clock): BusinessDate {
  const instant = now === undefined ? activeClock() : typeof now === "function" ? now() : now;
  return formatFns(new TZDate(instant.getTime(), businessTimeZone()), "yyyy-MM-dd");
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MS_PER_DAY = 86_400_000;

type Ymd = { y: number; m: number; d: number };

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

function toYmd(date: BusinessDate): Ymd {
  const match = ISO_DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid business date "${date}" (expected YYYY-MM-DD)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid business date "${date}"`);
  return { y, m, d };
}

function fromYmd({ y, m, d }: Ymd): BusinessDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Day number since 1970-01-01 (UTC midnight is used only as a calendar counter). */
function dayNumber(date: BusinessDate): number {
  const { y, m, d } = toYmd(date);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** Checks a `YYYY-MM-DD` string is a real calendar date. */
export function isBusinessDate(value: string): boolean {
  try {
    toYmd(value);
    return true;
  } catch {
    return false;
  }
}

/** Adds calendar months, clamping to the month end: Jan 31 + 1 month = Feb 28 (Feb 29 in leap years). */
export function addMonths(date: BusinessDate, months: number): BusinessDate {
  if (!Number.isInteger(months)) throw new Error(`months must be an integer: ${months}`);
  const { y, m, d } = toYmd(date);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return fromYmd({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

/** Adds (or subtracts) calendar days. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isInteger(days)) throw new Error(`days must be an integer: ${days}`);
  const t = new Date((dayNumber(date) + days) * MS_PER_DAY);
  return fromYmd({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Whole days from `from` to `to` (negative when `to` is earlier): Jan 1 → Apr 1, 2026 = 90. */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** Last day of the date's month: `monthEnd("2028-02-10")` → `"2028-02-29"`. */
export function monthEnd(date: BusinessDate): BusinessDate {
  const { y, m } = toYmd(date);
  return fromYmd({ y, m, d: daysInMonth(y, m) });
}

/** Calendar quarter, 1–4. */
export function quarterOf(date: BusinessDate): 1 | 2 | 3 | 4 {
  return (Math.floor((toYmd(date).m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Display format used across the UI: `"2026-10-07"` → `"Oct 07, 2026"`. */
export function formatDate(date: BusinessDate): string {
  const { y, m, d } = toYmd(date);
  return `${MONTHS[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
}
