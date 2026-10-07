import type Decimal from "decimal.js";

/**
 * Money is an integer number of centavos (₱1.00 = 100n). Every amount in the system is a
 * `Money`; JS `number` is never used for amounts, and nothing in this module touches floats.
 * Rounding happens only in `mulRate` (HALF-UP by default) at the points listed in
 * docs/DOMAIN.md §3.
 */
export type Money = bigint;

/** How to round a result that falls between two centavos. */
export type RoundingMode =
  /** Half away from zero: 12.5 → 13, -12.5 → -13. The default everywhere (DOMAIN §3). */
  | "HALF_UP"
  /** Half to even (banker's rounding): 12.5 → 12, 13.5 → 14. */
  | "HALF_EVEN"
  /** Toward zero (truncate): 12.9 → 12, -12.9 → -12. */
  | "DOWN"
  /** Away from zero: 12.1 → 13, -12.1 → -13. */
  | "UP";

export const ZERO: Money = 0n;

const AMOUNT_RE = /^(-)?\s*₱?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
const RATE_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a peso amount typed by a person: `"1,234.56"`, `"₱1,234.56"`, `"-50"`, `"0.5"`.
 * Thousands separators must be well-formed and at most 2 decimals are allowed
 * (a third decimal would need rounding, which parsing never does).
 */
export function parse(input: string): Money {
  const m = AMOUNT_RE.exec(input.trim());
  if (!m) throw new Error(`Invalid amount: "${input}"`);
  const [, minus, whole = "0", frac = ""] = m;
  const centavos = BigInt(whole.replaceAll(",", "")) * 100n + BigInt(frac.padEnd(2, "0"));
  return minus ? -centavos : centavos;
}

/** `123456n` → `"₱1,234.56"`, `-5000n` → `"-₱50.00"`. */
export function format(amount: Money): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const pesos = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centavos = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₱${pesos}.${centavos}`;
}

export function add(a: Money, b: Money): Money {
  return a + b;
}

export function sub(a: Money, b: Money): Money {
  return a - b;
}

export function sum(amounts: Iterable<Money>): Money {
  let total = 0n;
  for (const a of amounts) total += a;
  return total;
}

/** Divides `n` by a positive `d`, rounding to an integer with `mode`. */
function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d <= 0n) throw new Error("divisor must be positive");
  const q = n / d; // truncates toward zero
  const r = n % d; // same sign as n
  if (r === 0n) return q;
  const step = n < 0n ? -1n : 1n;
  const twiceRem = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case "DOWN":
      return q;
    case "UP":
      return q + step;
    case "HALF_UP":
      return twiceRem >= d ? q + step : q;
    case "HALF_EVEN":
      if (twiceRem > d) return q + step;
      if (twiceRem < d) return q;
      return q % 2n === 0n ? q : q + step;
  }
}

/** Splits a decimal string such as `"0.02"` into an integer numerator and a power-of-ten scale. */
function parseRate(rate: string | Decimal): { num: bigint; scale: bigint } {
  const text = typeof rate === "string" ? rate.trim() : rate.toFixed();
  const m = RATE_RE.exec(text);
  if (!m) throw new Error(`Invalid rate: "${text}" (expected a decimal string such as "0.02")`);
  const [, minus, whole = "0", frac = ""] = m;
  const num = BigInt(whole + frac);
  return { num: minus ? -num : num, scale: 10n ** BigInt(frac.length) };
}

/**
 * `amount × rate`, rounded to the centavo (HALF-UP unless told otherwise).
 * The rate is a decimal string (or a decimal.js value), never a JS number:
 * `mulRate(91680n, "0.02")` → `1834n` (₱916.80 × 2% = ₱18.336 → ₱18.34).
 */
export function mulRate(amount: Money, rate: string | Decimal, mode: RoundingMode = "HALF_UP"): Money {
  const { num, scale } = parseRate(rate);
  return divRound(amount * num, scale, mode);
}

/**
 * Splits `total` across `weights` with the largest-remainder method, so the parts always sum
 * to `total` exactly. Leftover centavos go to the largest remainders; ties go to the earlier
 * weight. `allocate(10000n, [1, 1, 1])` → `[3334n, 3333n, 3333n]`.
 * Weights are non-negative integers (bigint, or safe-integer numbers) and must not all be zero.
 */
export function allocate(total: Money, weights: readonly (bigint | number)[]): Money[] {
  const w = weights.map((x) => {
    if (typeof x === "number" && !Number.isSafeInteger(x)) throw new Error(`Weight must be an integer: ${x}`);
    const b = BigInt(x);
    if (b < 0n) throw new Error(`Weight must not be negative: ${x}`);
    return b;
  });
  const totalWeight = sum(w);
  if (totalWeight === 0n) throw new Error("allocate() needs at least one positive weight");

  const negative = total < 0n;
  const abs = negative ? -total : total;
  const parts = w.map((wi) => (abs * wi) / totalWeight);
  let leftover = abs - sum(parts);

  const order = w
    .map((wi, index) => ({ index, rem: (abs * wi) % totalWeight }))
    .sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of order) {
    if (leftover === 0n) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return negative ? parts.map((p) => -p) : parts;
}
