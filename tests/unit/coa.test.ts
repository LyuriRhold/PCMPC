import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { missingMappingKeys, parseCoaCsv } from "@/modules/ledger/coa";
import { PROVISIONAL_COA, REQUIRED_MAPPING_KEYS } from "@/modules/ledger/provisional-coa";

const HEAD = "code,name,type,normal_balance,parent_code,postable,sca_code,mapping_keys";

describe("chart of accounts", () => {
  it("the provisional COA maps every required DOMAIN §6 key exactly once, only on postable accounts", () => {
    expect(missingMappingKeys(PROVISIONAL_COA)).toEqual([]);
    const keys = PROVISIONAL_COA.flatMap((r) => r.mappingKeys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of REQUIRED_MAPPING_KEYS) expect(keys).toContain(k);
    // Extra keys beyond DOMAIN §6 (e.g. other-income accounts used by cashiering settings).
    expect(keys.filter((k) => !(REQUIRED_MAPPING_KEYS as readonly string[]).includes(k)).sort()).toEqual(["certification_fee_income", "rental_income"]);
    for (const r of PROVISIONAL_COA) if (r.mappingKeys.length) expect(r.isPostable, r.code).toBe(true);
  });

  it("the docs/coa template parses back to the provisional COA", () => {
    const rows = parseCoaCsv(readFileSync("docs/coa/provisional-coa.csv", "utf8"));
    expect(rows).toEqual(PROVISIONAL_COA);
  });

  it("parses quoted names and semicolon key lists", () => {
    const rows = parseCoaCsv(
      [HEAD, "1,ASSETS,ASSET,DR,,false,,", '11110,"Cash, on hand",ASSET,DR,1,true,1-01,cash_on_hand; cash_in_bank'].join("\n"),
    );
    expect(rows[1]).toMatchObject({ name: "Cash, on hand", parentCode: "1", isPostable: true, scaCode: "1-01", mappingKeys: ["cash_on_hand", "cash_in_bank"] });
  });

  it.each([
    ["wrong header", "code,name\n1,A", /header/],
    ["bad type", `${HEAD}\n1,A,ASSETS,DR,,false,,`, /type/],
    ["bad side", `${HEAD}\n1,A,ASSET,DEBIT,,false,,`, /normal_balance/],
    ["duplicate code", `${HEAD}\n1,A,ASSET,DR,,false,,\n1,B,ASSET,DR,,false,,`, /duplicate code/],
    ["unknown parent", `${HEAD}\n2,B,ASSET,DR,9,true,,`, /parent 9/],
    ["key on header", `${HEAD}\n1,A,ASSET,DR,,false,,cash_on_hand`, /postable/],
    ["key twice", `${HEAD}\n1,A,ASSET,DR,,true,,cash_on_hand\n2,B,ASSET,DR,,true,,cash_on_hand`, /more than one/],
  ])("rejects %s", (_name, csv, err) => {
    expect(() => parseCoaCsv(csv)).toThrow(err);
  });
});
