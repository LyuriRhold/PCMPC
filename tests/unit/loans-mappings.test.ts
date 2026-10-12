import { describe, expect, it } from "vitest";
import { PROVISIONAL_COA, REQUIRED_MAPPING_KEYS } from "@/modules/ledger/provisional-coa";
import { SAMPLE_LOAN_PRODUCTS } from "@/modules/loans/seed";

describe("T10.1 loan products' account mappings (DOMAIN §6)", () => {
  it("each sample product's receivable and every deduction's account are required and mapped", () => {
    const keys = SAMPLE_LOAN_PRODUCTS.flatMap((p) => [`loans_receivable_${p.code}`, ...p.deductions.map((d) => d.glKey)]);
    for (const k of new Set(keys)) {
      expect(REQUIRED_MAPPING_KEYS as readonly string[], k).toContain(k);
      expect(PROVISIONAL_COA.some((a) => a.mappingKeys.includes(k)), k).toBe(true);
    }
  });

  it("the sample products follow DOMAIN §2", () => {
    expect(SAMPLE_LOAN_PRODUCTS.map((p) => [p.code, p.method, p.ratePm, p.minTerm, p.maxTerm])).toEqual([
      ["REG", "DIMINISHING_EQUAL_AMORT", "0.015", 6, 24],
      ["EMR", "ADD_ON", "0.015", 1, 6],
      ["PRD", "DIMINISHING_EQUAL_PRINCIPAL", "0.01", 6, 12],
    ]);
  });
});
