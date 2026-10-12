import { addDays, daysBetween, type BusinessDate } from "@/lib/dates";
import { divide, mulRate, mulRateRatio, type Money } from "@/lib/money";

/**
 * Deposit interest (PHASE-09 T9.3, DOMAIN §2/§3), pure functions. Day count actual/365; one
 * HALF-UP rounding per account (DOMAIN §3: "each savings interest credit per account").
 */

/** A balance change on a day (signed: + deposit/interest, − withdrawal). */
export type Move = { date: BusinessDate; amount: Money };

/**
 * Σ of the daily closing balances from `from` to `to` (both included), in centavo-days, and the
 * number of days. `opening` is the balance before `from`; moves outside the period are ignored.
 */
export function balanceDays(opening: Money, moves: Move[], from: BusinessDate, to: BusinessDate): { sum: bigint; days: number } {
  const days = daysBetween(from, to) + 1;
  if (days <= 0) throw new Error(`empty period ${from}–${to}`);
  const changes = new Map<BusinessDate, Money>();
  for (const m of moves) if (m.date >= from && m.date <= to) changes.set(m.date, (changes.get(m.date) ?? 0n) + m.amount);
  const dates = [...changes.keys()].sort();
  let sum = 0n;
  let balance = opening;
  let day = from;
  for (const d of dates) {
    // The balance holds from `day` to the day before `d`; on `d` it changes (closing balance).
    sum += balance * BigInt(daysBetween(day, d));
    balance += changes.get(d) ?? 0n;
    day = d;
  }
  sum += balance * BigInt(daysBetween(day, addDays(to, 1)));
  return { sum, days };
}

/** Average daily balance, rounded HALF-UP to the centavo (for display and reports). */
export function averageDailyBalance(sum: bigint, days: number): Money {
  return divide(sum, BigInt(days));
}

/**
 * Savings interest for a period: ADB × rate × days ÷ 365 = Σ daily balances × rate ÷ 365, rounded
 * once. Zero when the ADB is below `minBalanceEarn` (compared exactly: Σ < min × days).
 */
export function savingsInterest(input: { sum: bigint; days: number; ratePa: string; minBalanceEarn: Money }): Money {
  if (input.sum <= 0n || input.sum < input.minBalanceEarn * BigInt(input.days)) return 0n;
  return mulRateRatio(input.sum, input.ratePa, 1n, 365n);
}

/** Simple interest on a time deposit: principal × rate × days ÷ 365, rounded once. */
export function simpleInterest(principal: Money, ratePa: string, days: number): Money {
  if (days <= 0) return 0n;
  return mulRateRatio(principal, ratePa, BigInt(days), 365n);
}

/** Withholding tax on an interest amount (HALF-UP; 0 when the rate is 0). */
export function withholdingTax(interest: Money, wtaxRate: string): Money {
  return interest > 0n ? mulRate(interest, wtaxRate) : 0n;
}

/** The calendar quarter that ends on `periodEnd`, or null if it isn't a quarter end (Mar 31, Jun 30, Sep 30, Dec 31). */
export function quarterEnding(periodEnd: BusinessDate): { start: BusinessDate; end: BusinessDate } | null {
  const ends = ["03-31", "06-30", "09-30", "12-31"];
  const md = periodEnd.slice(5);
  const i = ends.indexOf(md);
  if (i < 0) return null;
  const year = periodEnd.slice(0, 4);
  return { start: `${year}-${String(i * 3 + 1).padStart(2, "0")}-01`, end: periodEnd };
}
