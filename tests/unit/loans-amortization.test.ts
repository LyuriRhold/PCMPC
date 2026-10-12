import { describe, expect, it } from "vitest";
import { effectiveMonthlyRate, levelPayment, netProceeds, schedule, scheduleTotals, type AmortizationMethod } from "@/modules/loans/amortization";

const P = (pesos: number, centavos = 0) => BigInt(pesos) * 100n + BigInt(centavos);
const first = "2026-11-07";

describe("T10.2 diminishing, equal amortization (golden A10.1)", () => {
  const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: first });

  it("level payment ₱916.80 and the first rows", () => {
    expect(levelPayment(P(10000), "0.015", 12)).toBe(P(916, 80));
    expect(rows.slice(0, 3).map((r) => [r.interest, r.principal, r.balance])).toEqual([
      [P(150), P(766, 80), P(9233, 20)],
      [P(138, 50), P(778, 30), P(8454, 90)],
      [P(126, 82), P(789, 98), P(7664, 92)],
    ]);
  });

  it("the last row absorbs the residue; total interest ₱1,001.61", () => {
    expect(rows[11]).toMatchObject({ no: 12, payment: P(916, 81), interest: P(13, 55), principal: P(903, 26), balance: 0n });
    expect(scheduleTotals(rows)).toEqual({ principal: P(10000), interest: P(1001, 61), payment: P(11001, 61), regularPayment: P(916, 80) });
  });

  it("a zero rate pays the principal in equal parts", () => {
    const z = schedule({ principal: P(1000), ratePm: "0", term: 3, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: first });
    expect(z.map((r) => [r.payment, r.interest])).toEqual([
      [P(333, 33), 0n],
      [P(333, 33), 0n],
      [P(333, 34), 0n],
    ]);
  });
});

describe("T10.2 diminishing, equal principal (golden A10.3)", () => {
  it("₱12,000 at 1% for 12 months: ₱1,120 first, ₱1,010 last, interest ₱780", () => {
    const rows = schedule({ principal: P(12000), ratePm: "0.01", term: 12, method: "DIMINISHING_EQUAL_PRINCIPAL", firstDueDate: first });
    expect(rows[0]).toMatchObject({ principal: P(1000), interest: P(120), payment: P(1120), balance: P(11000) });
    expect(rows[11]).toMatchObject({ principal: P(1000), interest: P(10), payment: P(1010), balance: 0n });
    expect(scheduleTotals(rows).interest).toBe(P(780));
  });

  it("an uneven split puts the residue on the last row", () => {
    const rows = schedule({ principal: P(1000), ratePm: "0.01", term: 6, method: "DIMINISHING_EQUAL_PRINCIPAL", firstDueDate: first });
    expect(rows.slice(0, 5).every((r) => r.principal === P(166, 67))).toBe(true);
    expect(rows[5]?.principal).toBe(P(166, 65));
  });
});

describe("T10.2 add-on (golden A10.2)", () => {
  it("₱10,000 at 1.5% for 12 months: interest ₱1,800, ₱983.33 × 11 and ₱983.37", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "ADD_ON", firstDueDate: first });
    expect(rows.slice(0, 11).every((r) => r.payment === P(983, 33) && r.interest === P(150))).toBe(true);
    expect(rows[11]).toMatchObject({ payment: P(983, 37), interest: P(150), principal: P(833, 37), balance: 0n });
    expect(scheduleTotals(rows)).toMatchObject({ principal: P(10000), interest: P(1800), payment: P(11800) });
  });
});

describe("T10.2 due dates (golden A10.10)", () => {
  it("each due date is the first plus k months, clamped to the month end", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 4, method: "ADD_ON", firstDueDate: "2026-01-31" });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    const leap = schedule({ principal: P(10000), ratePm: "0.015", term: 2, method: "ADD_ON", firstDueDate: "2028-01-31" });
    expect(leap[1]?.dueDate).toBe("2028-02-29");
  });
});

describe("T10.2 properties (deterministic random loans)", () => {
  it("for every method the principal sums to the loan, the balance falls to 0 and never goes negative", () => {
    // MINSTD: products stay below 2^53, so the sequence is exact.
    let seed = 20261012;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const methods: AmortizationMethod[] = ["DIMINISHING_EQUAL_AMORT", "DIMINISHING_EQUAL_PRINCIPAL", "ADD_ON"];
    for (let i = 0; i < 600; i++) {
      const principal = BigInt(1 + rand(100_000_000)); // up to ₱1,000,000
      const term = 1 + rand(36);
      const ratePm = (rand(400) / 10000).toFixed(4); // 0% to 4% a month
      const method = methods[i % 3]!;
      const rows = schedule({ principal, ratePm, term, method, firstDueDate: "2026-01-31" });
      expect(rows).toHaveLength(term);
      expect(scheduleTotals(rows).principal).toBe(principal);
      expect(rows.at(-1)?.balance).toBe(0n);
      for (const r of rows) {
        expect(r.balance >= 0n && r.interest >= 0n && r.principal >= 0n && r.payment === r.principal + r.interest).toBe(true);
      }
    }
  });

  it("rejects bad input", () => {
    expect(() => schedule({ principal: 0n, ratePm: "0.01", term: 12, method: "ADD_ON", firstDueDate: first })).toThrow(/more than zero/);
    expect(() => schedule({ principal: P(100), ratePm: "0.01", term: 0, method: "ADD_ON", firstDueDate: first })).toThrow(/term/);
    expect(() => schedule({ principal: P(100), ratePm: "-1", term: 12, method: "ADD_ON", firstDueDate: first })).toThrow(/rate/);
  });
});

describe("T10.3 net proceeds (golden A10.4)", () => {
  it("service fee 2%, CBU 2%, notarial ₱100 on ₱10,000 → net ₱9,500", () => {
    const r = netProceeds(P(10000), [
      { code: "SERVICE_FEE", name: "Service fee", basis: "PCT_OF_PRINCIPAL", value: "0.02", glKey: "service_fee_income" },
      { code: "CBU", name: "CBU", basis: "PCT_OF_PRINCIPAL", value: "0.02", glKey: "subscription_receivable_common" },
      { code: "NOTARIAL", name: "Notarial fee", basis: "FIXED", value: "10000", glKey: "notarial_fee_income" },
    ]);
    expect(r).toEqual({
      lines: [
        { code: "SERVICE_FEE", name: "Service fee", amount: P(200), glKey: "service_fee_income" },
        { code: "CBU", name: "CBU", amount: P(200), glKey: "subscription_receivable_common" },
        { code: "NOTARIAL", name: "Notarial fee", amount: P(100), glKey: "notarial_fee_income" },
      ],
      total: P(500),
      net: P(9500),
    });
  });

  it("percentages round HALF-UP; deductions can't exceed the loan", () => {
    expect(netProceeds(P(333, 33), [{ code: "SERVICE_FEE", name: "Fee", basis: "PCT_OF_PRINCIPAL", value: "0.015" }]).lines[0]?.amount).toBe(P(5)); // 4.99995 → 5.00
    expect(() => netProceeds(P(50), [{ code: "NOTARIAL", name: "Notarial", basis: "FIXED", value: "10000" }])).toThrow(/more than the loan/);
  });
});

describe("effective interest rate (disclosure)", () => {
  it("is the monthly rate when nothing is deducted; higher when deductions reduce the net", () => {
    const rows = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: first });
    const payments = rows.map((r) => r.payment);
    expect(Number(effectiveMonthlyRate(P(10000), payments))).toBeCloseTo(0.015, 4);
    expect(Number(effectiveMonthlyRate(P(9500), payments))).toBeGreaterThan(0.023);
    expect(effectiveMonthlyRate(P(20000), payments)).toBe("0");
  });
});

describe("review follow-ups: tiny loans and long terms", () => {
  it("no row is ever negative, the principal sums to the loan and the balance ends at 0 (1 centavo to ₱50, 1 to 360 months)", () => {
    const methods: AmortizationMethod[] = ["DIMINISHING_EQUAL_AMORT", "DIMINISHING_EQUAL_PRINCIPAL", "ADD_ON"];
    for (const method of methods) {
      for (const term of [1, 2, 12, 36, 360]) {
        for (const ratePm of ["0", "0.005", "0.015", "0.04"]) {
          for (let principal = 1n; principal <= 5_000n; principal += principal < 100n ? 1n : 97n) {
            const rows = schedule({ principal, ratePm, term, method, firstDueDate: "2026-01-31" });
            let sum = 0n;
            for (const r of rows) {
              if (r.principal < 0n || r.interest < 0n || r.payment < 0n || r.balance < 0n || r.payment !== r.principal + r.interest) {
                throw new Error(`${method} ${principal} centavos, ${term} months at ${ratePm}: row ${r.no} ${JSON.stringify({ ...r, principal: String(r.principal), interest: String(r.interest), payment: String(r.payment), balance: String(r.balance) })}`);
              }
              sum += r.principal;
            }
            expect(sum).toBe(principal);
            expect(rows.at(-1)?.balance).toBe(0n);
          }
        }
      }
    }
  });

  it("add-on totals stay exact on a 360-month ₱1.00 loan", () => {
    const rows = schedule({ principal: P(1), ratePm: "0.005", term: 360, method: "ADD_ON", firstDueDate: first });
    expect(scheduleTotals(rows)).toMatchObject({ principal: P(1), interest: P(1, 80), payment: P(2, 80) });
  });
});
