import { describe, expect, it } from "vitest";
import { MEMBER_SUBSIDIARY_KEYS, PROVISIONAL_COA, REQUIRED_MAPPING_KEYS } from "@/modules/ledger/provisional-coa";

describe("T9.1 savings account mappings (DOMAIN §6)", () => {
  const keys = ["savings_deposits", "time_deposits", "interest_expense_deposits", "withholding_tax_payable", "cash_on_hand"];

  it("every key the savings module posts to is required and mapped in the chart of accounts", () => {
    for (const k of keys) {
      expect(REQUIRED_MAPPING_KEYS as readonly string[], k).toContain(k);
      expect(PROVISIONAL_COA.some((a) => a.mappingKeys.includes(k)), k).toBe(true);
    }
  });

  it("savings and time deposits are member sub-ledgers", () => {
    expect(MEMBER_SUBSIDIARY_KEYS as readonly string[]).toEqual(expect.arrayContaining(["savings_deposits", "time_deposits"]));
  });
});
