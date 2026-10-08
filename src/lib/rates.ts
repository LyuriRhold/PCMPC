/**
 * Rates are stored as decimal-fraction strings ("0.025") and shown to people as percents ("2.5").
 * Conversions shift the decimal point as text, so no floating point is involved.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

function trim(intPart: string, fracPart: string): string {
  const i = intPart.replace(/^0+(?=\d)/, "") || "0";
  const f = fracPart.replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

/** `"2.5"` (percent) → `"0.025"` (fraction). Throws on anything but a non-negative decimal. */
export function percentToFraction(percent: string): string {
  const m = DECIMAL_RE.exec(percent.trim());
  if (!m) throw new Error(`Invalid percent "${percent}"`);
  const digits = (m[1] ?? "0").padStart(3, "0");
  const intPart = digits.slice(0, -2);
  const fracPart = digits.slice(-2) + (m[2] ?? "");
  return trim(intPart, fracPart);
}

/** `"0.025"` (fraction) → `"2.5"` (percent). */
export function fractionToPercent(fraction: string): string {
  const m = DECIMAL_RE.exec(fraction.trim());
  if (!m) throw new Error(`Invalid rate "${fraction}"`);
  const frac = (m[2] ?? "").padEnd(2, "0");
  return trim((m[1] ?? "0") + frac.slice(0, 2), frac.slice(2));
}
