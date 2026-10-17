import { describe, expect, it } from "vitest";
import { patronageOf, ratePercent, sharePool, splitSurplus, validatePercents, type SurplusPercents } from "@/modules/surplus/engine";

const DEFAULTS: SurplusPercents = { reserve: "0.10", etf: "0.10", cdf: "0.03", optional: "0.07", iscShare: "0.70", prShare: "0.30" };

describe("T15.2 the allocation engine", () => {
  it("every rule of the law has its own message; all of them are listed at once", () => {
    expect(validatePercents(DEFAULTS)).toEqual([]);
    expect(validatePercents({ ...DEFAULTS, cdf: "0.02" })).toEqual(["The community development fund must be at least 3% of net surplus (2.00% entered)"]);
    expect(validatePercents({ ...DEFAULTS, optional: "0.075" })).toEqual(["The optional fund can be at most 7% of net surplus (7.50% entered)"]);
    expect(validatePercents({ ...DEFAULTS, iscShare: "0.60" })).toEqual(["Interest on share capital and patronage refund must add up to 100% of what remains after the funds (90.00% entered)"]);
    expect(validatePercents({ ...DEFAULTS, reserve: "0.95" })).toEqual(["The funds can't take more than the whole net surplus (115.00% entered)"]);
    expect(validatePercents({ ...DEFAULTS, reserve: "ten" })).toEqual(["Enter each percentage as a number, zero or more"]);
    expect(validatePercents({ ...DEFAULTS, reserve: "0.05", etf: "0.2" })).toHaveLength(2);
    expect(() => splitSurplus(0n, DEFAULTS)).toThrow("There is no net surplus to allocate");
  });

  it("every split adds up to the centavo: funds + remaining = net surplus, local + CETF = ETF, ISC + PR = remaining", () => {
    // ₱1,234.57 at 12.5 / 10 / 3.25 / 7: the odd centavos go to the largest remainders.
    const s = splitSurplus(123457n, { reserve: "0.125", etf: "0.10", cdf: "0.0325", optional: "0.07", iscShare: "0.65", prShare: "0.35" });
    expect(s.reserve + s.etf + s.cdf + s.optional + s.remaining).toBe(123457n);
    expect(s.etfLocal + s.cetf).toBe(s.etf);
    expect(s.etfLocal - s.cetf).toBeLessThanOrEqual(1n);
    expect(s.iscPool + s.prPool).toBe(s.remaining);
    expect(s).toMatchObject({ reserve: 15432n, etf: 12346n, etfLocal: 6173n, cetf: 6173n, cdf: 4012n, optional: 8642n, remaining: 83025n, iscPool: 53966n, prPool: 29059n });
    for (let n = 1n; n < 400n; n += 37n) {
      const t = splitSurplus(n * 1009n, DEFAULTS);
      expect(t.reserve + t.etfLocal + t.cetf + t.cdf + t.optional + t.iscPool + t.prPool).toBe(n * 1009n);
    }
  });

  it("a pool is shared by weight, to the centavo; an empty pool shares nothing; a pool nobody can share is refused", () => {
    expect(sharePool(100001n, [1n, 1n, 1n]).amounts).toEqual([33334n, 33334n, 33333n]);
    expect(sharePool(0n, [5n, 0n])).toEqual({ rate: "0", amounts: [0n, 0n] });
    expect(() => sharePool(100n, [0n, 0n])).toThrow("Nobody shares this pool");
    expect(sharePool(980000n, [1200000n, 900000n, 7700000n])).toEqual({ rate: "0.1", amounts: [120000n, 90000n, 770000n] });
    expect(ratePercent("0.0333333333")).toBe("3.33%");
    expect(ratePercent("5")).toBe("500.00%");
  });

  it("patronage counts what the basis says: loan interest, net store purchases, water bills", () => {
    const p = { loanInterest: 300000n, store: 700000n, water: 50000n };
    expect(patronageOf(p, { loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: false })).toBe(1000000n);
    expect(patronageOf(p, { loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: true })).toBe(1050000n);
    expect(patronageOf(p, { loanInterestPaid: false, netStorePurchases: true, waterBillsPaidByMembers: false })).toBe(700000n);
  });
});
