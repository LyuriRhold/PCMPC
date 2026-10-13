import Decimal from "decimal.js";
import { mulRate, type Money } from "@/lib/money";

/**
 * The moving-average stock engine (PHASE-12 T12.2, DOMAIN §3). Pure: no database. A balance is the
 * quantity on hand, its value in centavos (the source of truth) and the average unit cost in pesos
 * with 4 decimals.
 *
 * - Receipt: value += cost; avg = value ÷ qty, rounded HALF-UP to 4 decimals.
 * - Issue: COGS = qty × avg, rounded HALF-UP to the centavo; when the issue empties the stock,
 *   COGS = the remaining value, so no centavos are left behind. Never below zero stock.
 */

export type StockBalance = { qty: number; avgCost: string; value: Money };

export const EMPTY_STOCK: StockBalance = { qty: 0, avgCost: "0.0000", value: 0n };

/** A stock rule was broken; the message is safe to show. */
export class StockError extends Error {
  override name = "StockError";
}

function assertQty(qty: number): void {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new StockError("The quantity must be a whole number more than zero");
}

/** The average unit cost of `value` centavos over `qty` units: pesos, 4 decimals, HALF-UP. */
export function averageCost(value: Money, qty: number): string {
  return new Decimal(value.toString()).div(qty).div(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** The cost of `qty` units at a 4-decimal peso unit cost, in centavos (HALF-UP). */
export function costOf(qty: number, unitCost: string): Money {
  return mulRate(BigInt(qty) * 100n, unitCost);
}

/** Stock received: `cost` is the total cost of the `qty` units, in centavos. */
export function receiveStock(balance: StockBalance, qty: number, cost: Money): StockBalance {
  assertQty(qty);
  if (cost < 0n) throw new StockError("The cost can't be negative");
  const total = balance.qty + qty;
  const value = balance.value + cost;
  return { qty: total, avgCost: averageCost(value, total), value };
}

/** Stock issued at the moving average. The average stays as it was (also when the stock reaches 0). */
export function issueStock(balance: StockBalance, qty: number): { cogs: Money; balance: StockBalance } {
  assertQty(qty);
  if (qty > balance.qty) throw new StockError(`Insufficient stock (${balance.qty})`);
  if (qty === balance.qty) return { cogs: balance.value, balance: { qty: 0, avgCost: balance.avgCost, value: 0n } };
  const cost = costOf(qty, balance.avgCost);
  // The 4-decimal average can round up; the stock left never goes below zero value.
  const cogs = cost > balance.value ? balance.value : cost;
  return { cogs, balance: { qty: balance.qty - qty, avgCost: balance.avgCost, value: balance.value - cogs } };
}
