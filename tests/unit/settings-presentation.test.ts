import { describe, expect, it } from "vitest";
import { PRESENTATION } from "@/modules/settings/presentation";
import { SETTING_KEYS, SETTINGS } from "@/modules/settings/registry";
import { describe as show, DraftError, fromDraft, toDraft } from "@/modules/settings/ui/value-format";

/** Same value regardless of how a decimal is written ("0.10" = "0.1", "2.0" = "2"). */
function normal(v: unknown): unknown {
  if (typeof v === "string" && /^\d+\.\d+$/.test(v)) return v.replace(/0+$/, "").replace(/\.$/, "");
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normal(x)]));
  return v;
}

describe("coop settings in plain language", () => {
  it("every editable setting's default survives the round trip through the form unchanged", () => {
    for (const key of SETTING_KEYS) {
      const p = PRESENTATION[key];
      if (p.readonly) continue;
      const stored = SETTINGS[key].default;
      const back = fromDraft(p.spec, toDraft(p.spec, stored), p.label);
      expect(normal(SETTINGS[key].schema.parse(back)), key).toEqual(normal(SETTINGS[key].schema.parse(stored)));
    }
  });

  it("no label or help shows an internal key, code or JSON", () => {
    for (const key of SETTING_KEYS) {
      const p = PRESENTATION[key];
      for (const text of [p.label, p.help, p.readonly?.reason ?? ""]) {
        expect(text, key).not.toMatch(/\b[a-z]{2,}\.[a-z_]{3,}\b|[A-Z]{3,}_[A-Z]|\{0+\}|mappingKey|DOMAIN/);
      }
    }
  });

  it("shows values the way people read them", () => {
    expect(show(PRESENTATION["water.penalty_pct"].spec, "0.10")).toBe("10% of the unpaid bill");
    expect(show(PRESENTATION["water.fee.reconnection"].spec, "30000")).toBe("₱300.00");
    expect(show(PRESENTATION["water.due_days"].spec, 15)).toBe("15 days after the bill date");
    expect(show(PRESENTATION["water.bill_paper"].spec, "HALF_LONG")).toBe("½ of long bond, lengthwise (2 bills per sheet)");
    expect(show(PRESENTATION["fiscal.year_start_month"].spec, 1)).toBe("January");
    expect(show(PRESENTATION["water.bill_disconnected_accounts"].spec, false)).toBe("Don't bill them");
    expect(show(PRESENTATION["loan.payment_allocation"].spec, { order: ["PENALTY", "INTEREST", "PRINCIPAL"], installments: "OLDEST_FIRST" })).toBe(
      "Apply payments to: Penalty → Interest → Principal\nInstallments: Oldest installment first",
    );
    expect(show(PRESENTATION["water.high_factor"].spec, { factor: "2.0", minM3: 10 })).toBe("Flag when usage is more than: 2× the 3-month average\nand more than: 10 m³");
  });

  it("turns what people type into stored values, with plain messages for mistakes", () => {
    expect(fromDraft(PRESENTATION["water.penalty_pct"].spec, "12.5", "Late payment penalty")).toBe("0.125");
    expect(fromDraft(PRESENTATION["water.fee.connection"].spec, "3,500.00", "Connection fee")).toBe("350000");
    expect(() => fromDraft(PRESENTATION["water.fee.connection"].spec, "abc", "Connection fee")).toThrow(new DraftError("Connection fee: enter an amount in pesos, e.g. 300.00"));
    expect(() => fromDraft(PRESENTATION["water.due_days"].spec, "0", "Bills are due")).toThrow("Bills are due: must be at least 1");
    expect(() => fromDraft(PRESENTATION["loan.payment_allocation"].spec, { order: ["PENALTY", "PENALTY", "PRINCIPAL"], installments: "OLDEST_FIRST" }, "How loan payments are applied")).toThrow(
      "Apply payments to: each item can appear only once",
    );
    expect(fromDraft(PRESENTATION["loan.allowance_rates"].spec, { Current: "", "1–30": "5" }, "Allowance")).toEqual({ Current: null, "1–30": "0.05" });
  });
});

describe("other income items", () => {
  it("a blank short code is made from the item name", () => {
    const spec = PRESENTATION["cash.other_income_items"].spec;
    expect(fromDraft(spec, [{ label: "Hall rental (half day)", mappingKey: "rental_income", code: "" }], "Other income")).toEqual([
      { label: "Hall rental (half day)", mappingKey: "rental_income", code: "HALL_RENTAL_HALF_DAY" },
    ]);
    expect(show(spec, [{ label: "Hall rental", mappingKey: "rental_income", code: "HALL_RENTAL" }], { rental_income: "44130 Rental Income" })).toBe("Hall rental · 44130 Rental Income");
  });
});
