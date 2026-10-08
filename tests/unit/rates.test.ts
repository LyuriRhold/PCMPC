import { describe, expect, it } from "vitest";
import { fractionToPercent, percentToFraction } from "@/lib/rates";

describe("rates", () => {
  it.each([
    ["2", "0.02", "2"],
    ["2.5", "0.025", "2.5"],
    ["10", "0.1", "10"],
    ["100", "1", "100"],
    ["0", "0", "0"],
    ["0.5", "0.005", "0.5"],
    ["150", "1.5", "150"],
    ["7.000", "0.07", "7"],
  ])("%s%% → %s → %s%%", (percent, fraction, back) => {
    expect(percentToFraction(percent)).toBe(fraction);
    expect(fractionToPercent(fraction)).toBe(back);
  });

  it.each([
    ["0.02", "2"],
    ["0.10", "10"],
    ["0.025", "2.5"],
    ["0", "0"],
    ["1", "100"],
    ["2.0", "200"],
    ["0.00125", "0.125"],
  ])("fraction %s → %s%%", (fraction, percent) => {
    expect(fractionToPercent(fraction)).toBe(percent);
  });

  it("rejects bad input", () => {
    for (const bad of ["", "-1", "abc", "1.2.3", "2%"]) {
      expect(() => percentToFraction(bad)).toThrow();
      expect(() => fractionToPercent(bad)).toThrow();
    }
  });
});
