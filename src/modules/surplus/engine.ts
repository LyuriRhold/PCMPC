import Decimal from "decimal.js";
import { allocate, type Money } from "@/lib/money";
import type { PrBasis } from "./schema";

/**
 * The net surplus allocation engine (PHASE-15 T15.2), pure: the statutory funds and the pools of
 * interest on share capital (ISC) and patronage refund (PR), and each member's share of a pool.
 * Every split uses money.allocate (largest remainder, DOMAIN §3), so the parts always add up to the
 * whole: net surplus = funds + remaining; ETF = local + CETF; remaining = ISC pool + PR pool; a pool
 * = Σ members' shares.
 */

/** A rule of the allocation was broken; the message is safe to show. */
export class SurplusError extends Error {
  override name = "SurplusError";
}

/** Fractions as decimal strings ("0.10" is 10%): the funds of net surplus, then ISC and PR of what remains. */
export type SurplusPercents = { reserve: string; etf: string; cdf: string; optional: string; iscShare: string; prShare: string };

export type SurplusSplit = {
  netSurplus: Money;
  reserve: Money;
  etf: Money;
  etfLocal: Money;
  cetf: Money;
  cdf: Money;
  optional: Money;
  remaining: Money;
  iscPool: Money;
  prPool: Money;
};

/**
 * The law's floors and ceilings (RA 9520 Art. 86; the PR floor is CDA guidance). They bound the
 * settings too (settings registry); the percentages themselves come from the settings or the GA.
 */
const LAW = { reserveMin: "0.10", etfMax: "0.10", cdfMin: "0.03", optionalMax: "0.07", prMin: "0.30" } as const;

const RATE_RE = /^\d+(\.\d+)?$/;
/** "0.08" → "8.00%". */
export function ratePercent(rate: string): string {
  return `${new Decimal(rate).mul(100).toFixed(2, Decimal.ROUND_HALF_UP)}%`;
}
const lawPercent = (rate: string) => `${new Decimal(rate).mul(100).toString()}%`;

/** Every rule the percentages break (empty when they are fine). */
export function validatePercents(p: SurplusPercents): string[] {
  const values = [p.reserve, p.etf, p.cdf, p.optional, p.iscShare, p.prShare];
  if (values.some((v) => !RATE_RE.test(v))) return ["Enter each percentage as a number, zero or more"];
  const d = (v: string) => new Decimal(v);
  const problems: string[] = [];
  if (d(p.reserve).lt(LAW.reserveMin)) problems.push(`The reserve fund must be at least ${lawPercent(LAW.reserveMin)} of net surplus (${ratePercent(p.reserve)} entered)`);
  if (d(p.etf).gt(LAW.etfMax)) problems.push(`The education and training fund can be at most ${lawPercent(LAW.etfMax)} of net surplus (${ratePercent(p.etf)} entered)`);
  if (d(p.cdf).lt(LAW.cdfMin)) problems.push(`The community development fund must be at least ${lawPercent(LAW.cdfMin)} of net surplus (${ratePercent(p.cdf)} entered)`);
  if (d(p.optional).gt(LAW.optionalMax)) problems.push(`The optional fund can be at most ${lawPercent(LAW.optionalMax)} of net surplus (${ratePercent(p.optional)} entered)`);
  const funds = d(p.reserve).plus(p.etf).plus(p.cdf).plus(p.optional);
  if (funds.gt(1)) problems.push(`The funds can't take more than the whole net surplus (${ratePercent(funds.toString())} entered)`);
  if (d(p.prShare).lt(LAW.prMin)) problems.push(`The patronage refund must be at least ${lawPercent(LAW.prMin)} of what remains after the funds (${ratePercent(p.prShare)} entered)`);
  const shares = d(p.iscShare).plus(p.prShare);
  if (!shares.eq(1)) problems.push(`Interest on share capital and patronage refund must add up to 100% of what remains after the funds (${ratePercent(shares.toString())} entered)`);
  return problems;
}

/** Fractions as whole-number weights on a common scale ("0.1", "0.03" → 10n, 3n). */
export function weightsOf(fractions: string[]): bigint[] {
  const scale = Math.max(0, ...fractions.map((f) => (f.split(".")[1] ?? "").length));
  return fractions.map((f) => {
    const [i = "0", frac = ""] = f.split(".");
    return BigInt(i + frac.padEnd(scale, "0"));
  });
}

/** Splits `parts` of a whole by fractions; the last part takes 1 − Σ fractions (allocate keeps it exact). */
function splitByFractions(total: Money, fractions: string[]): Money[] {
  const rest = new Decimal(1).minus(fractions.reduce((s, f) => s.plus(f), new Decimal(0))).toFixed();
  const weights = weightsOf([...fractions, rest]);
  if (weights.every((w) => w === 0n)) return weights.map(() => 0n);
  return allocate(total, weights);
}

/** The statutory funds and the ISC and PR pools of a net surplus (blocked when the percentages break the law). */
export function splitSurplus(netSurplus: Money, p: SurplusPercents): SurplusSplit {
  const problems = validatePercents(p);
  if (problems.length) throw new SurplusError(problems.join("; "));
  if (netSurplus <= 0n) throw new SurplusError("There is no net surplus to allocate");
  const [reserve, etf, cdf, optional, remaining] = splitByFractions(netSurplus, [p.reserve, p.etf, p.cdf, p.optional]) as [Money, Money, Money, Money, Money];
  const [etfLocal, cetf] = etf > 0n ? (allocate(etf, [1, 1]) as [Money, Money]) : [0n, 0n];
  const [iscPool, prPool] = remaining > 0n ? (allocate(remaining, weightsOf([p.iscShare, p.prShare])) as [Money, Money]) : [0n, 0n];
  return { netSurplus, reserve, etf, etfLocal, cetf, cdf, optional, remaining, iscPool, prPool };
}

/**
 * Each member's share of a pool by weight (ASM for ISC, patronage for PR): the rate is pool ÷ Σ
 * weights; the amounts are split with allocate, so they add up to the pool to the centavo.
 */
export function sharePool(pool: Money, weights: Money[]): { rate: string; amounts: Money[] } {
  const total = weights.reduce((s, w) => s + w, 0n);
  if (pool === 0n) return { rate: "0", amounts: weights.map(() => 0n) };
  if (total <= 0n) throw new SurplusError("Nobody shares this pool");
  return { rate: new Decimal(pool.toString()).div(total.toString()).toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toString(), amounts: allocate(pool, weights) };
}

/** A member's patronage: what the basis counts (non-members have none). */
export function patronageOf(p: { loanInterest: Money; store: Money; water: Money }, basis: PrBasis): Money {
  return (basis.loanInterestPaid ? p.loanInterest : 0n) + (basis.netStorePurchases ? p.store : 0n) + (basis.waterBillsPaidByMembers ? p.water : 0n);
}
