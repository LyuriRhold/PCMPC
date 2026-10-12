import Decimal from "decimal.js";
import { daysBetween, type BusinessDate } from "@/lib/dates";
import { mulRateRatio, type Money } from "@/lib/money";

/** Portfolio aging, PAR and penalties (PHASE-11 T11.4/T11.5), pure functions. */

/** Days past due = business date − due date of the oldest unpaid installment (0 when none is overdue). */
export function daysPastDue(oldestUnpaidDue: BusinessDate | null, asOf: BusinessDate): number {
  if (!oldestUnpaidDue) return 0;
  const d = daysBetween(oldestUnpaidDue, asOf);
  return d > 0 ? d : 0;
}

export type AgingBucket = { label: string; fromDays: number; toDays: number | null };

/** The loan.aging_buckets label for a number of days past due. */
export function bucketFor(dpd: number, buckets: AgingBucket[]): string {
  const b = buckets.find((x) => dpd >= x.fromDays && (x.toDays === null || dpd <= x.toDays));
  return b?.label ?? buckets.at(-1)?.label ?? "";
}

/** PAR: outstanding principal of loans more than `thresholdDays` past due ÷ all outstanding principal, as a percentage with 2 decimals. */
export function parPercent(rows: Array<{ outstandingPrincipal: Money; daysPastDue: number }>, thresholdDays: number): string {
  const total = rows.reduce((s, r) => s + r.outstandingPrincipal, 0n);
  if (total === 0n) return "0.00";
  const atRisk = rows.filter((r) => r.daysPastDue > thresholdDays).reduce((s, r) => s + r.outstandingPrincipal, 0n);
  return new Decimal(atRisk.toString()).mul(100).div(total.toString()).toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * Penalty to date on an installment: Σ(unpaid amount × days) × monthly rate ÷ 30, rounded HALF-UP
 * once (DOMAIN §2 loan.penalty_rate_pm, prorated by days/30). The running Σ keeps daily runs and a
 * single catch-up run giving the same total.
 */
export function penaltyToDate(basisDays: bigint, ratePm: string): Money {
  return mulRateRatio(basisDays, ratePm, 1n, 30n);
}
