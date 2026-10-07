import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { add, allocate, format, mulRate, parse, sub, sum } from "@/lib/money";

describe("money.parse", () => {
  it.each([
    ["0", 0n],
    ["5", 500n],
    ["0.5", 50n],
    ["0.05", 5n],
    ["1234.56", 123456n],
    ["1,234.56", 123456n],
    ["₱1,234.56", 123456n],
    ["  ₱ 12,345,678.90 ", 1234567890n],
    ["-50", -5000n],
    ["-₱50.00", -5000n],
    ["999,999,999,999.99", 99999999999999n],
  ])("%s → %s", (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "1,23.00", "12,34", "1e5", "₱", "--5", "1.", ".5"])("rejects %j", (input) => {
    expect(() => parse(input)).toThrow(/Invalid amount/);
  });

  it("round-trips with format", () => {
    for (const v of [0n, 1n, 99n, 100n, 123456n, -5000n, 100000000n]) expect(parse(format(v))).toBe(v);
  });
});

describe("money.format", () => {
  it.each([
    [0n, "₱0.00"],
    [1n, "₱0.01"],
    [-1n, "-₱0.01"],
    [100000n, "₱1,000.00"],
    [123456789n, "₱1,234,567.89"],
    [-123456789n, "-₱1,234,567.89"],
  ])("%s → %s", (input, expected) => {
    expect(format(input)).toBe(expected);
  });
});

describe("money arithmetic", () => {
  it("add / sub / sum", () => {
    expect(add(150n, 250n)).toBe(400n);
    expect(sub(150n, 250n)).toBe(-100n);
    expect(sum([])).toBe(0n);
    expect(sum([1n, 2n, 3n])).toBe(6n);
  });
});

describe("money.mulRate", () => {
  it("rounds HALF-UP away from zero by default", () => {
    expect(mulRate(25n, "0.5")).toBe(13n);
    expect(mulRate(-25n, "0.5")).toBe(-13n);
    expect(mulRate(24n, "0.5")).toBe(12n);
    expect(mulRate(91680n, "0.02")).toBe(1834n);
  });

  it("supports DOWN, UP and HALF_EVEN", () => {
    expect(mulRate(25n, "0.5", "DOWN")).toBe(12n);
    expect(mulRate(-25n, "0.5", "DOWN")).toBe(-12n);
    expect(mulRate(21n, "0.5", "UP")).toBe(11n);
    expect(mulRate(-21n, "0.5", "UP")).toBe(-11n);
    expect(mulRate(25n, "0.5", "HALF_EVEN")).toBe(12n);
    expect(mulRate(27n, "0.5", "HALF_EVEN")).toBe(14n);
    expect(mulRate(-27n, "0.5", "HALF_EVEN")).toBe(-14n);
    expect(mulRate(26n, "0.5", "HALF_EVEN")).toBe(13n);
  });

  it("handles long rates exactly (no float drift)", () => {
    // ₱1,000,000.00 × 0.015/12 monthly = 0.00125 → ₱1,250.00
    expect(mulRate(100000000n, "0.00125")).toBe(125000n);
    // float trap: in JS numbers 100 * 1.005 = 100.49999999999999, which would round to 100
    expect(mulRate(100n, "1.005")).toBe(101n);
    expect(mulRate(1n, "0.4999999999999999999")).toBe(0n);
    expect(mulRate(1n, "0.5000000000000000000")).toBe(1n);
  });

  it("accepts whole-number, negative and decimal.js rates", () => {
    expect(mulRate(1000n, "3")).toBe(3000n);
    expect(mulRate(1000n, "-0.1")).toBe(-100n);
    expect(mulRate(91680n, new Decimal("0.02"))).toBe(1834n);
    expect(mulRate(100n, new Decimal("1e-7"))).toBe(0n);
  });

  it("rejects malformed rates", () => {
    for (const bad of ["", "abc", "1/2", "2%", ".5", "1e-2"]) expect(() => mulRate(100n, bad)).toThrow(/Invalid rate/);
  });
});

describe("money.allocate", () => {
  it("gives leftover centavos to the largest remainders, ties to the earlier weight", () => {
    expect(allocate(10000n, [1, 1, 1])).toEqual([3334n, 3333n, 3333n]);
    expect(allocate(100n, [1, 2])).toEqual([33n, 67n]);
    expect(allocate(5n, [1, 1, 1, 1, 1, 1])).toEqual([1n, 1n, 1n, 1n, 1n, 0n]);
    expect(allocate(1000n, [0, 1, 0])).toEqual([0n, 1000n, 0n]);
  });

  it("handles negative totals and bigint weights", () => {
    expect(allocate(-10000n, [1, 1, 1])).toEqual([-3334n, -3333n, -3333n]);
    expect(allocate(10000n, [250000n, 150000n, 100000n])).toEqual([5000n, 3000n, 2000n]);
    expect(allocate(0n, [1, 2])).toEqual([0n, 0n]);
  });

  it("always sums to the total (property check, deterministic seed)", () => {
    let seed = 20261007;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 500; i++) {
      const total = BigInt(rand(10_000_000)) - 2_000_000n;
      const weights = Array.from({ length: 1 + rand(12) }, () => rand(1000));
      if (!weights.some((w) => w > 0)) weights.push(1);
      const parts = allocate(total, weights);
      expect(sum(parts)).toBe(total);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it("rejects bad weights", () => {
    expect(() => allocate(100n, [])).toThrow();
    expect(() => allocate(100n, [0, 0])).toThrow(/positive weight/);
    expect(() => allocate(100n, [1, -1])).toThrow(/negative/);
    expect(() => allocate(100n, [0.5, 1])).toThrow(/integer/);
  });
});
