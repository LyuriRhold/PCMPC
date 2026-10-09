import { describe, expect, it } from "vitest";
import { consumptionFor, estimateFrom, flagsFor, type ConsumptionInput, type FlagRules } from "@/modules/water/consumption";

const base: ConsumptionInput = { previous: 1250, present: 1268, digits: 4, rollover: false };
const rules: FlagRules = { high: { factor: "2.0", minM3: 10 }, low: { factor: "0.3", zero: true } };

describe("consumptionFor (pure)", () => {
  it.each([
    [1250, 1268, 18],
    [0, 0, 0],
    [0, 9999, 9999],
    [5, 5, 0],
  ])("normal: previous %i, present %i → %i m³", (previous, present, m3) => {
    expect(consumptionFor({ ...base, previous, present })).toEqual({ consumption: m3, metered: m3, overEstimated: 0, type: "ACTUAL" });
  });

  it.each([
    [4, 9990, 12, 22],
    [4, 9999, 0, 1],
    [4, 1, 0, 9999],
    [3, 995, 3, 8],
    [6, 999_990, 15, 25],
  ])("rollover on a %i-digit meter: %i → %i = %i m³", (digits, previous, present, m3) => {
    expect(consumptionFor({ previous, present, digits, rollover: true }).consumption).toBe(m3);
  });

  it("a lower reading without rollover is rejected with the previous reading", () => {
    expect(() => consumptionFor({ ...base, present: 1240 })).toThrow("Reading is lower than previous (1,250)");
  });

  it("rollover can't be marked on a reading that isn't lower", () => {
    expect(() => consumptionFor({ ...base, rollover: true })).toThrow(/only when the meter passed its maximum/);
    expect(() => consumptionFor({ ...base, present: 1250, rollover: true })).toThrow(/only when/);
  });

  it("rejects readings beyond the dial and bad numbers", () => {
    expect(() => consumptionFor({ ...base, present: 10_000 })).toThrow(/below 10,000/);
    expect(() => consumptionFor({ ...base, present: 12.5 })).toThrow(/whole number/);
    expect(() => consumptionFor({ ...base, previous: -1 })).toThrow(/whole number/);
    expect(() => consumptionFor({ ...base, digits: 2 })).toThrow(/digits/);
  });

  it("meter change: (old final − previous) + (new present − new initial)", () => {
    expect(consumptionFor({ previous: 1250, present: 9, digits: 4, rollover: false, changes: [{ oldFinal: 1262, newInitial: 0 }] })).toEqual({
      consumption: 21,
      metered: 21,
      overEstimated: 0,
      type: "METER_CHANGE",
    });
  });

  it("two meter changes chain, and the new meter may roll over", () => {
    const changes = [
      { oldFinal: 1262, newInitial: 0 },
      { oldFinal: 5, newInitial: 990 },
    ];
    expect(consumptionFor({ previous: 1250, present: 999, digits: 3, rollover: false, changes }).consumption).toBe(12 + 5 + 9);
    expect(consumptionFor({ previous: 1250, present: 4, digits: 3, rollover: true, changes }).consumption).toBe(12 + 5 + 14);
  });

  it("an old meter's final reading below its previous reading is rejected", () => {
    expect(() => consumptionFor({ previous: 1250, present: 9, digits: 4, rollover: false, changes: [{ oldFinal: 1200, newInitial: 0 }] })).toThrow(/final reading \(1,200\) is lower than its previous reading \(1,250\)/);
  });

  it("subtracts estimates billed since the last actual reading (A6.6: 1,290 − 1,250 − 15 = 25)", () => {
    expect(consumptionFor({ ...base, present: 1290, estimatedSince: 15 })).toEqual({ consumption: 25, metered: 40, overEstimated: 0, type: "ACTUAL" });
  });

  it("over-estimates bill 0 m³ and report the excess", () => {
    expect(consumptionFor({ ...base, present: 1260, estimatedSince: 15 })).toEqual({ consumption: 0, metered: 10, overEstimated: 5, type: "ACTUAL" });
  });
});

describe("estimateFrom", () => {
  it.each([
    [[12, 15, 18], 15],
    [[10, 11], 11],
    [[10, 10, 11], 10],
    [[1, 2], 2],
    [[0], 0],
  ])("average of %j → %i m³ (HALF-UP)", (history, m3) => {
    expect(estimateFrom(history)).toBe(m3);
  });

  it("needs at least one actual month", () => {
    expect(() => estimateFrom([])).toThrow(/no actual readings/);
  });
});

describe("flagsFor", () => {
  it("A6.5: 40 m³ against 12, 15, 18 (avg 15) → HIGH", () => {
    expect(flagsFor({ consumption: 40, history: [18, 15, 12], rollover: false }, rules)).toEqual(["HIGH"]);
  });

  it("HIGH needs more than factor × average AND more than the minimum", () => {
    expect(flagsFor({ consumption: 30, history: [15, 15, 15], rollover: false }, rules)).toEqual([]);
    expect(flagsFor({ consumption: 31, history: [15, 15, 15], rollover: false }, rules)).toEqual(["HIGH"]);
    expect(flagsFor({ consumption: 10, history: [2, 2, 2], rollover: false }, rules)).toEqual([]);
    expect(flagsFor({ consumption: 11, history: [2, 2, 2], rollover: false }, rules)).toEqual(["HIGH"]);
  });

  it("LOW below factor × average; ZERO at 0; no history → no HIGH/LOW", () => {
    expect(flagsFor({ consumption: 4, history: [15, 15, 15], rollover: false }, rules)).toEqual(["LOW"]);
    expect(flagsFor({ consumption: 5, history: [15, 15, 15], rollover: false }, rules)).toEqual([]);
    expect(flagsFor({ consumption: 0, history: [15], rollover: false }, rules)).toEqual(["ZERO"]);
    expect(flagsFor({ consumption: 0, history: [], rollover: false }, { ...rules, low: { factor: "0.3", zero: false } })).toEqual([]);
    expect(flagsFor({ consumption: 500, history: [], rollover: false }, rules)).toEqual([]);
  });

  it("a rollover reading is always flagged LOWER for review", () => {
    expect(flagsFor({ consumption: 22, history: [], rollover: true }, rules)).toEqual(["LOWER"]);
    expect(flagsFor({ consumption: 40, history: [15], rollover: true }, rules)).toEqual(["LOWER", "HIGH"]);
  });
});
