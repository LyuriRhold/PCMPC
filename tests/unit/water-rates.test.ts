import { describe, expect, it } from "vitest";
import { chargeFor, validateSchedule, type Schedule } from "@/modules/water/rates";

const P = (pesos: number) => BigInt(pesos) * 100n;

/** DOMAIN §2 sample tariffs (CONFIRM). */
const RES: Schedule = {
  minCharge: P(200),
  minCubic: 10,
  blocks: [
    { from: 11, to: 20, rate: "2500" },
    { from: 21, to: 30, rate: "3000" },
    { from: 31, to: null, rate: "3500" },
  ],
};
const COM: Schedule = { minCharge: P(400), minCubic: 10, blocks: [{ from: 11, to: null, rate: "4000" }] };

/** Reference implementation: price each m³ one at a time. */
function slow(s: Schedule, m3: number): bigint {
  let total = s.minCharge;
  for (let unit = s.minCubic + 1; unit <= m3; unit++) {
    const b = s.blocks.find((x) => unit >= x.from && (x.to === null || unit <= x.to));
    total += BigInt(b!.rate);
  }
  return total;
}

describe("water rate engine (pure)", () => {
  it.each([
    [0, 200],
    [1, 200],
    [10, 200],
    [11, 225],
    [20, 450],
    [21, 480],
    [30, 750],
    [31, 785],
    [35, 925],
    [100, 3200],
  ])("RESIDENTIAL %i m³ → ₱%i", (m3, pesos) => {
    expect(chargeFor(RES, m3).total).toBe(P(pesos));
  });

  it.each([
    [0, 400],
    [10, 400],
    [11, 440],
    [15, 600],
    [50, 2000],
  ])("COMMERCIAL %i m³ → ₱%i", (m3, pesos) => {
    expect(chargeFor(COM, m3).total).toBe(P(pesos));
  });

  it("agrees with a unit-by-unit reference for 0–500 m³", () => {
    for (let m3 = 0; m3 <= 500; m3++) {
      expect(chargeFor(RES, m3).total).toBe(slow(RES, m3));
      expect(chargeFor(COM, m3).total).toBe(slow(COM, m3));
    }
  });

  it("itemizes the minimum and each block used", () => {
    const c = chargeFor(RES, 35);
    expect(c.lines.map((l) => [l.label, l.amount])).toEqual([
      ["Minimum charge (first 10 m³)", P(200)],
      ["11–20 m³: 10 × ₱25.00", P(250)],
      ["21–30 m³: 10 × ₱30.00", P(300)],
      ["31+ m³: 5 × ₱35.00", P(175)],
    ]);
  });

  it("rejects fractional or negative consumption", () => {
    expect(() => chargeFor(RES, -1)).toThrow();
    expect(() => chargeFor(RES, 1.5)).toThrow();
  });
});

describe("schedule validation", () => {
  it("accepts the sample tariffs", () => {
    expect(() => validateSchedule(RES)).not.toThrow();
    expect(() => validateSchedule(COM)).not.toThrow();
  });

  it.each([
    ["a gap between blocks", { ...RES, blocks: [{ from: 11, to: 20, rate: "2500" }, { from: 22, to: null, rate: "3000" }] }, /start at 21/],
    ["a block not starting after the minimum", { ...RES, blocks: [{ from: 10, to: null, rate: "2500" }] }, /start at 11/],
    ["a closed last block", { ...RES, blocks: [{ from: 11, to: 20, rate: "2500" }] }, /open-ended/],
    ["an open middle block", { ...RES, blocks: [{ from: 11, to: null, rate: "2500" }, { from: 21, to: null, rate: "3000" }] }, /Only the last/],
    ["a non-integer rate", { ...COM, blocks: [{ from: 11, to: null, rate: "40.5" }] }, /centavos/],
    ["no blocks", { ...COM, blocks: [] }, /at least one/],
  ])("rejects %s", (_n, s, err) => {
    expect(() => validateSchedule(s as Schedule)).toThrow(err);
  });
});
