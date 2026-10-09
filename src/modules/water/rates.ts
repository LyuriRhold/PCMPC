import { and, desc, eq, lte } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { formatDate, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { waterRateSchedules, type Classification, type CustomerType, type RateBlock, type TariffAppliesTo } from "./schema";

export const APPLIES_LABEL: Record<TariffAppliesTo, string> = { ALL: "all customers", MEMBER: "members", NON_MEMBER: "non-members" };

/** A tariff rule was broken; the message is safe to show. */
export class RateError extends Error {
  override name = "RateError";
}

export type Schedule = { minCharge: Money; minCubic: number; blocks: RateBlock[] };
export type ChargeLine = { label: string; m3: number; rate: Money | null; amount: Money };
export type Charge = { lines: ChargeLine[]; total: Money };

/**
 * Checks a tariff's blocks: they start right after the minimum, follow on without gaps, and
 * only the last one is open-ended (to = null). Rates are non-negative centavos.
 */
export function validateSchedule(s: Schedule): void {
  if (!Number.isInteger(s.minCubic) || s.minCubic < 0) throw new RateError("The minimum cubic meters must be a whole number ≥ 0");
  if (s.minCharge < 0n) throw new RateError("The minimum charge can't be negative");
  if (s.blocks.length === 0) throw new RateError("Add at least one rate block above the minimum");
  let expectedFrom = s.minCubic + 1;
  s.blocks.forEach((b, i) => {
    const last = i === s.blocks.length - 1;
    if (!Number.isInteger(b.from) || b.from !== expectedFrom) throw new RateError(`Block ${i + 1} must start at ${expectedFrom} m³`);
    if (b.to === null && !last) throw new RateError(`Only the last block can be open-ended`);
    if (b.to !== null && (!Number.isInteger(b.to) || b.to < b.from)) throw new RateError(`Block ${i + 1} must end at or after ${b.from} m³`);
    if (last && b.to !== null) throw new RateError("The last block must be open-ended (no upper limit)");
    if (!/^\d+$/.test(b.rate)) throw new RateError(`Block ${i + 1}: the rate must be centavos as a whole number`);
    expectedFrom = (b.to ?? 0) + 1;
  });
}

/**
 * Pure tariff calculation: the minimum charge covers the first `minCubic` m³; each m³ above is
 * charged at its block's rate. All in centavos, so no rounding is needed (DOMAIN §3).
 */
export function chargeFor(s: Schedule, m3: number): Charge {
  if (!Number.isInteger(m3) || m3 < 0) throw new RateError("Consumption must be a whole number of m³ ≥ 0");
  const lines: ChargeLine[] = [{ label: `Minimum charge (first ${s.minCubic} m³)`, m3: Math.min(m3, s.minCubic), rate: null, amount: s.minCharge }];
  for (const b of s.blocks) {
    if (m3 < b.from) break;
    const upper = b.to === null ? m3 : Math.min(m3, b.to);
    const units = upper - b.from + 1;
    const rate = BigInt(b.rate);
    lines.push({ label: `${b.from}${b.to === null ? "+" : `–${b.to}`} m³: ${units} × ${format(rate)}`, m3: units, rate, amount: rate * BigInt(units) });
  }
  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0n) };
}

async function latestVersion(db: Db | Tx, classification: Classification, appliesTo: TariffAppliesTo, date: BusinessDate) {
  const [s] = await db
    .select()
    .from(waterRateSchedules)
    .where(and(eq(waterRateSchedules.classification, classification), eq(waterRateSchedules.appliesTo, appliesTo), lte(waterRateSchedules.effectiveFrom, date)))
    .orderBy(desc(waterRateSchedules.effectiveFrom))
    .limit(1);
  return s ?? null;
}

/**
 * The tariff version in effect on a date for a classification (latest effective_from ≤ date).
 * With a customer type, that type's own version (members-only / non-members-only) wins when one
 * is in effect; otherwise the version for everyone applies.
 */
export async function scheduleOn(classification: Classification, date: BusinessDate, db: Db | Tx = getDb(), customerType?: CustomerType) {
  if (customerType) {
    const own = await latestVersion(db, classification, customerType, date);
    if (own) return own;
  }
  return latestVersion(db, classification, "ALL", date);
}

/** Water charge for `m3` m³ of a classification (and customer type), using the version effective on the period end. */
export async function computeWaterCharge(classification: Classification, m3: number, periodEnd: BusinessDate, db: Db | Tx = getDb(), customerType?: CustomerType) {
  const s = await scheduleOn(classification, periodEnd, db, customerType);
  if (!s) throw new RateError(`No ${classification} rate schedule is in effect on ${formatDate(periodEnd)}`);
  return { scheduleId: s.id, effectiveFrom: s.effectiveFrom, nwrbRef: s.nwrbRef, ...chargeFor(s, m3) };
}

export type NewSchedule = Schedule & { classification: Classification; appliesTo?: TariffAppliesTo; effectiveFrom: BusinessDate; nwrbRef: string };

/**
 * Adds a tariff version. Versions are never edited: a change is a new version that takes effect
 * after the latest existing one, so periods already priced keep their tariff.
 */
export async function addRateSchedule(tx: Tx, input: NewSchedule, actorId: string | null) {
  validateSchedule(input);
  if (!input.nwrbRef.trim()) throw new RateError("Enter the NWRB approval reference");
  const appliesTo = input.appliesTo ?? "ALL";
  const [latest] = await tx
    .select({ effectiveFrom: waterRateSchedules.effectiveFrom })
    .from(waterRateSchedules)
    .where(and(eq(waterRateSchedules.classification, input.classification), eq(waterRateSchedules.appliesTo, appliesTo)))
    .orderBy(desc(waterRateSchedules.effectiveFrom))
    .limit(1)
    .for("update");
  if (latest && input.effectiveFrom <= latest.effectiveFrom) {
    throw new RateError(`A new ${input.classification}${appliesTo === "ALL" ? "" : ` (${APPLIES_LABEL[appliesTo]})`} version must take effect after ${formatDate(latest.effectiveFrom)}`);
  }
  const [row] = await tx
    .insert(waterRateSchedules)
    .values({
      classification: input.classification,
      appliesTo,
      effectiveFrom: input.effectiveFrom,
      minCharge: input.minCharge,
      minCubic: input.minCubic,
      blocks: input.blocks,
      nwrbRef: input.nwrbRef.trim(),
      approvedAt: null,
      createdBy: actorId,
    })
    .returning();
  if (!row) throw new Error("rate schedule insert returned no row");
  await audit(tx, {
    action: "water.rate_schedule_add",
    entity: "water_rate_schedule",
    entityId: row.id,
    after: { classification: row.classification, appliesTo: row.appliesTo, effectiveFrom: row.effectiveFrom, minCharge: row.minCharge, minCubic: row.minCubic, blocks: row.blocks, nwrbRef: row.nwrbRef },
    userId: actorId,
  });
  return row;
}
