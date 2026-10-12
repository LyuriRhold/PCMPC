import Decimal from "decimal.js";
import type { ProductWithDeductions } from "../service";
import type { ProductOption } from "./loan-forms";

/** A product as plain data for the client forms (money as centavo strings). */
export function productOption(p: ProductWithDeductions): ProductOption {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    method: p.method,
    ratePm: p.ratePm,
    minTerm: p.minTerm,
    maxTerm: p.maxTerm,
    maxAmount: p.maxAmount === null ? null : String(p.maxAmount),
    maxMultipleOfPaidUp: p.maxMultipleOfPaidUp,
    requiredComakers: p.requiredComakers,
    deductions: p.deductions.map((d) => ({ code: d.code, name: d.name, basis: d.basis, value: d.value, glKey: d.glKey })),
  };
}

/** "0.015" → "1.5" (percent, for display and forms). */
export const pct = (rate: string) => new Decimal(rate).mul(100).toFixed();
