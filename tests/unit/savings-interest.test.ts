import { describe, expect, it } from "vitest";
import { mulRateRatio } from "@/lib/money";
import { averageDailyBalance, balanceDays, lastQuarterEnd, quarterEnding, savingsInterest, simpleInterest, withholdingTax } from "@/modules/savings/interest";

const P = (pesos: number, centavos = 0) => BigInt(pesos) * 100n + BigInt(centavos);
const Q1 = { from: "2026-01-01", to: "2026-03-31" };
const rule = { ratePa: "0.02", minBalanceEarn: P(500) };

describe("T9.3 balance-days and ADB", () => {
  it("a constant balance for the 90-day quarter", () => {
    const r = balanceDays(P(10000), [], Q1.from, Q1.to);
    expect(r).toEqual({ sum: P(10000) * 90n, days: 90 });
    expect(averageDailyBalance(r.sum, r.days)).toBe(P(10000));
  });

  it("a deposit counts in that day's closing balance", () => {
    const r = balanceDays(0n, [{ date: "2026-01-01", amount: P(10000) }, { date: "2026-02-15", amount: P(10000) }], Q1.from, Q1.to);
    expect(r.sum).toBe(P(10000) * 45n + P(20000) * 45n);
    expect(averageDailyBalance(r.sum, r.days)).toBe(P(15000));
  });

  it("moves on the same day add up; moves outside the period are ignored", () => {
    const r = balanceDays(P(1000), [{ date: "2026-03-31", amount: P(500) }, { date: "2026-03-31", amount: -P(200) }, { date: "2026-04-01", amount: P(9999) }], Q1.from, Q1.to);
    expect(r.sum).toBe(P(1000) * 89n + P(1300));
  });

  it("a withdrawal on the first day lowers the whole period", () => {
    expect(balanceDays(P(5000), [{ date: "2026-01-01", amount: -P(1000) }], Q1.from, Q1.to).sum).toBe(P(4000) * 90n);
  });
});

describe("T9.3 savings interest (2% p.a., actual/365, min ₱500 ADB)", () => {
  it("₱10,000 for 90 days → ₱49.32 (HALF-UP of 49.315…)", () => {
    expect(savingsInterest({ sum: P(10000) * 90n, days: 90, ...rule })).toBe(P(49, 32));
  });

  it("ADB ₱15,000 for 90 days → ₱73.97", () => {
    expect(savingsInterest({ sum: P(15000) * 90n, days: 90, ...rule })).toBe(P(73, 97));
  });

  it("no interest below the minimum ADB; exactly the minimum earns", () => {
    expect(savingsInterest({ sum: P(400) * 90n, days: 90, ...rule })).toBe(0n);
    expect(savingsInterest({ sum: P(500) * 90n - 1n, days: 90, ...rule })).toBe(0n);
    expect(savingsInterest({ sum: P(500) * 90n, days: 90, ...rule })).toBe(P(2, 47)); // 500 × 0.02 × 90/365 = 2.4657…
  });

  it("zero and empty balances earn nothing", () => {
    expect(savingsInterest({ sum: 0n, days: 90, ...rule })).toBe(0n);
  });
});

describe("T9.4 time-deposit interest", () => {
  it("₱50,000 at 3% for 180 days → ₱739.73; at 2% for 90 days → ₱246.58", () => {
    expect(simpleInterest(P(50000), "0.03", 180)).toBe(P(739, 73));
    expect(simpleInterest(P(50000), "0.02", 90)).toBe(P(246, 58));
    expect(simpleInterest(P(50000), "0.02", 0)).toBe(0n);
  });
});

describe("withholding tax and quarters", () => {
  it("withholding tax is HALF-UP on the interest; 0% gives 0", () => {
    expect(withholdingTax(P(49, 32), "0")).toBe(0n);
    expect(withholdingTax(P(49, 32), "0.20")).toBe(P(9, 86)); // 9.864
    expect(withholdingTax(P(0, 5), "0.20")).toBe(1n);
  });

  it("quarter ends only", () => {
    expect(quarterEnding("2026-03-31")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterEnding("2026-12-31")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterEnding("2026-06-30")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterEnding("2026-03-30")).toBeNull();
  });

  it("mulRateRatio rounds once, exactly", () => {
    expect(mulRateRatio(P(50000), "0.03", 180n, 365n)).toBe(P(739, 73));
    expect(mulRateRatio(150n, "1", 1n, 12n)).toBe(13n);
  });
});

describe("review follow-ups", () => {
  it("lastQuarterEnd", () => {
    expect(lastQuarterEnd("2026-01-01")).toBe("2025-12-31");
    expect(lastQuarterEnd("2026-04-10")).toBe("2026-03-31");
    expect(lastQuarterEnd("2026-07-01")).toBe("2026-06-30");
    expect(lastQuarterEnd("2026-12-31")).toBe("2026-09-30");
  });
});
