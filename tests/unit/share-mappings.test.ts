import { describe, expect, it } from "vitest";
import { MEMBER_SUBSIDIARY_KEYS, PROVISIONAL_COA, REQUIRED_MAPPING_KEYS } from "@/modules/ledger/provisional-coa";

describe("T8.1 share capital account mappings (DOMAIN §6)", () => {
  const keys = ["subscription_receivable_common", "subscribed_share_capital_common", "membership_fee_income", "cash_on_hand"];

  it("every key share capital posts to is required and mapped in the chart of accounts", () => {
    for (const k of keys) {
      expect(REQUIRED_MAPPING_KEYS as readonly string[], k).toContain(k);
      expect(PROVISIONAL_COA.some((a) => a.mappingKeys.includes(k)), k).toBe(true);
    }
  });

  it("subscribed share capital and subscription receivable are member sub-ledgers", () => {
    expect(MEMBER_SUBSIDIARY_KEYS as readonly string[]).toEqual(expect.arrayContaining(["subscribed_share_capital_common", "subscription_receivable_common"]));
  });
});
