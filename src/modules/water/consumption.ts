import Decimal from "decimal.js";
import type { ReadingFlag } from "./schema";

/**
 * Pure consumption engine (PHASE-06 business rules). No database access: callers pass the
 * previous reading, any meter changes since then, and the account's recent actual history.
 */

/** A reading that can't be accepted; the message is safe to show. */
export class ConsumptionError extends Error {
  override name = "ConsumptionError";
}

const fmt = (n: number) => n.toLocaleString("en-US");

function assertReading(n: number, what: string) {
  if (!Number.isInteger(n) || n < 0) throw new ConsumptionError(`${what} must be a whole number of 0 or more`);
}

export type MeterChange = {
  /** Final reading of the meter that was removed. */
  oldFinal: number;
  /** Initial reading of the meter that replaced it. */
  newInitial: number;
};

export type ConsumptionInput = {
  /** Last actual reading, on the meter in place at that time (or that meter's initial reading). */
  previous: number;
  /** Present reading on the meter installed now. */
  present: number;
  /** Dial digits of the meter installed now: it rolls over after 10^digits − 1. */
  digits: number;
  /** The reader marked that the meter passed its maximum (present < previous). */
  rollover: boolean;
  /** Meters replaced since `previous`, oldest first. */
  changes?: MeterChange[];
  /** Estimated m³ already billed since the last actual reading. */
  estimatedSince?: number;
};

export type ConsumptionResult = {
  /** m³ to bill: the metered use minus estimates already billed (never below 0). */
  consumption: number;
  /** m³ that went through the meter(s) since the last actual reading. */
  metered: number;
  /** Estimated m³ billed that exceeded the metered use (only when consumption is 0). */
  overEstimated: number;
  type: "ACTUAL" | "METER_CHANGE";
};

/**
 * Normal: present − previous. Rollover (marked): 10^digits − previous + present. Meter change:
 * (old final − previous) + … + (present − new initial). Then minus estimates already billed.
 */
export function consumptionFor(input: ConsumptionInput): ConsumptionResult {
  const { present, digits, rollover } = input;
  const changes = input.changes ?? [];
  const estimatedSince = input.estimatedSince ?? 0;
  assertReading(input.previous, "The previous reading");
  assertReading(present, "The present reading");
  assertReading(estimatedSince, "Estimated m³");
  if (!Number.isInteger(digits) || digits < 3 || digits > 9) throw new ConsumptionError("Meter digits must be between 3 and 9");
  const max = 10 ** digits;
  if (present >= max) throw new ConsumptionError(`The present reading must be below ${fmt(max)} on a ${digits}-digit meter`);

  let metered = 0;
  let start = input.previous;
  for (const c of changes) {
    assertReading(c.oldFinal, "The old meter's final reading");
    assertReading(c.newInitial, "The new meter's initial reading");
    if (c.oldFinal < start) throw new ConsumptionError(`The old meter's final reading (${fmt(c.oldFinal)}) is lower than its previous reading (${fmt(start)})`);
    metered += c.oldFinal - start;
    start = c.newInitial;
  }

  if (present >= start) {
    if (rollover) throw new ConsumptionError("Mark rollover only when the meter passed its maximum (the reading is lower than previous)");
    metered += present - start;
  } else {
    if (!rollover) throw new ConsumptionError(`Reading is lower than previous (${fmt(start)})`);
    metered += max - start + present;
  }

  const net = metered - estimatedSince;
  return {
    consumption: Math.max(0, net),
    metered,
    overEstimated: net < 0 ? -net : 0,
    type: changes.length > 0 ? "METER_CHANGE" : "ACTUAL",
  };
}

/** Estimated m³: the average of the recent actual months, rounded HALF-UP to a whole m³. */
export function estimateFrom(history: number[]): number {
  if (history.length === 0) throw new ConsumptionError("There are no actual readings to estimate from");
  history.forEach((h) => assertReading(h, "Past consumption"));
  const avg = new Decimal(history.reduce((s, h) => s + h, 0)).div(history.length);
  return avg.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export type FlagRules = {
  /** HIGH when consumption > factor × average and > minM3. */
  high: { factor: string; minM3: number };
  /** LOW when 0 < consumption < factor × average; ZERO when consumption is 0 (if enabled). */
  low: { factor: string; zero: boolean };
};

/** Review flags for a reading. `history` = recent actual consumption (newest first, up to 3). */
export function flagsFor(input: { consumption: number; history: number[]; rollover: boolean }, rules: FlagRules): ReadingFlag[] {
  const flags: ReadingFlag[] = [];
  const { consumption, history } = input;
  if (input.rollover) flags.push("LOWER");
  if (history.length > 0) {
    const avg = new Decimal(history.reduce((s, h) => s + h, 0)).div(history.length);
    if (consumption > rules.high.minM3 && new Decimal(consumption).gt(avg.mul(rules.high.factor))) flags.push("HIGH");
    if (consumption > 0 && new Decimal(consumption).lt(avg.mul(rules.low.factor))) flags.push("LOW");
  }
  if (rules.low.zero && consumption === 0) flags.push("ZERO");
  return flags;
}
