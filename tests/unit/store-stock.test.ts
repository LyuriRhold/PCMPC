import { describe, expect, it } from "vitest";
import { averageCost, costOf, EMPTY_STOCK, issueStock, receiveStock, StockError, type StockBalance } from "@/modules/store/stock";
import { P } from "../helpers/phase03";

describe("T12.2 stock engine", () => {
  it("averages to 4 decimals HALF-UP; the value is exact", () => {
    expect(averageCost(P(70, 4), 7)).toBe("10.0057");
    expect(averageCost(10n, 3)).toBe("0.0333"); // 10 centavos for 3
    expect(averageCost(5n, 1000)).toBe("0.0001"); // 0.00005 → 0.0001
    expect(receiveStock(EMPTY_STOCK, 3, P(10))).toEqual({ qty: 3, avgCost: "3.3333", value: P(10) });
  });

  it("COGS is qty × average rounded HALF-UP to the centavo, except the issue that empties the stock", () => {
    expect(costOf(3, "10.0057")).toBe(P(30, 2)); // 30.0171
    expect(costOf(1, "0.0050")).toBe(1n); // 0.5 centavo → 1
    const b = receiveStock(EMPTY_STOCK, 3, P(10)); // ₱10.00 for 3 → avg 3.3333
    const one = issueStock(b, 1);
    expect(one).toEqual({ cogs: P(3, 33), balance: { qty: 2, avgCost: "3.3333", value: P(6, 67) } });
    expect(issueStock(one.balance, 2)).toEqual({ cogs: P(6, 67), balance: { qty: 0, avgCost: "3.3333", value: 0n } });
  });

  it("quantities are whole numbers above zero; costs are not negative; stock never goes below zero", () => {
    expect(() => receiveStock(EMPTY_STOCK, 0, P(1))).toThrow(StockError);
    expect(() => receiveStock(EMPTY_STOCK, 1.5, P(1))).toThrow(/whole number/);
    expect(() => receiveStock(EMPTY_STOCK, 1, -1n)).toThrow(/can't be negative/);
    expect(() => issueStock(EMPTY_STOCK, 1)).toThrow("Insufficient stock (0)");
    expect(() => issueStock({ qty: 2, avgCost: "1.0000", value: P(2) }, -1)).toThrow(/whole number/);
  });

  it("property: over random receipts and issues the value never goes negative and Σ moves = the balance", () => {
    // MINSTD: products stay below 2^53, so the sequence is exact.
    let seed = 20261013;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    for (let run = 0; run < 300; run++) {
      let b: StockBalance = EMPTY_STOCK;
      let qtyIn = 0;
      let qtyOut = 0;
      let costIn = 0n;
      let cogsOut = 0n;
      for (let step = 0; step < 40; step++) {
        if (b.qty === 0 || rand(3) > 0) {
          const qty = 1 + rand(run % 2 ? 7 : 500);
          // Centavos per unit × qty, plus odd centavos so the averages don't come out even.
          const cost = BigInt(rand(run % 3 ? 100 : 1_000_000)) * BigInt(qty) + BigInt(rand(qty));
          b = receiveStock(b, qty, cost);
          qtyIn += qty;
          costIn += cost;
        } else {
          const qty = 1 + rand(b.qty);
          const out = issueStock(b, qty);
          expect(out.cogs).toBeGreaterThanOrEqual(0n);
          b = out.balance;
          qtyOut += qty;
          cogsOut += out.cogs;
        }
        expect(b.value).toBeGreaterThanOrEqual(0n);
        expect(b.qty).toBe(qtyIn - qtyOut);
        expect(b.value).toBe(costIn - cogsOut);
        if (b.qty === 0) expect(b.value).toBe(0n);
      }
    }
  });
});
