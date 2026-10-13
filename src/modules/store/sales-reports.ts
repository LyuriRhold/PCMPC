import Decimal from "decimal.js";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import type { BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { productCategories, products, saleLines, saleReturnLines, saleReturns, sales, stockBalances } from "./schema";

/**
 * Store sales reports (PHASE-13 T13.7). Sales count on their sale date and returns on their return
 * date. Net sales = sales − returns; gross margin = net sales − net cost of sales (the COGS of the
 * sales less the cost restocked by the returns).
 */

export type Figures = { qty: number; sales: Money; returns: Money; net: Money; cogs: Money; margin: Money; marginPct: string };

/** Gross margin as a percentage of net sales, 2 decimals. */
export function marginPct(margin: Money, net: Money): string {
  if (net === 0n) return "0.00";
  return new Decimal(margin.toString()).mul(100).div(net.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function figures(qty: number, salesAmt: Money, returnsAmt: Money, cogs: Money, returnedCost: Money): Figures {
  const net = salesAmt - returnsAmt;
  const netCogs = cogs - returnedCost;
  return { qty, sales: salesAmt, returns: returnsAmt, net, cogs: netCogs, margin: net - netCogs, marginPct: marginPct(net - netCogs, net) };
}

type Bucket = { qtySold: number; qtyBack: number; sales: Money; returns: Money; cogs: Money; back: Money };
const empty = (): Bucket => ({ qtySold: 0, qtyBack: 0, sales: 0n, returns: 0n, cogs: 0n, back: 0n });
const toFigures = (b: Bucket) => figures(b.qtySold - b.qtyBack, b.sales, b.returns, b.cogs, b.back);

/** Sales and gross margin in a date range: per day, per product, per category, and in total. */
export async function salesReport(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const sold = await db
    .select({
      day: sales.saleDate,
      productId: saleLines.productId,
      qty: sql<number>`sum(${saleLines.qty})::int`,
      amount: sql<string>`sum(${saleLines.lineTotal})::text`,
      cogs: sql<string>`sum(${saleLines.cogs})::text`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(sales.status, "COMPLETED"), gte(sales.saleDate, from), lte(sales.saleDate, to)))
    .groupBy(sales.saleDate, saleLines.productId);
  const back = await db
    .select({
      day: saleReturns.returnDate,
      productId: saleReturnLines.productId,
      qty: sql<number>`sum(${saleReturnLines.qty})::int`,
      amount: sql<string>`sum(${saleReturnLines.amount})::text`,
      cost: sql<string>`sum(${saleReturnLines.cost})::text`,
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturns.id, saleReturnLines.returnId))
    .where(and(gte(saleReturns.returnDate, from), lte(saleReturns.returnDate, to)))
    .groupBy(saleReturns.returnDate, saleReturnLines.productId);
  const [counts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sales)
    .where(and(eq(sales.status, "COMPLETED"), gte(sales.saleDate, from), lte(sales.saleDate, to)));
  const catalog = await db
    .select({ id: products.id, sku: products.sku, name: products.name, unit: products.unit, category: productCategories.name })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId));
  const info = new Map(catalog.map((p) => [p.id, p]));

  const byDay = new Map<string, Bucket>();
  const byProduct = new Map<string, Bucket>();
  const byCategory = new Map<string, Bucket>();
  const total = empty();
  const add = (map: Map<string, Bucket>, key: string, f: (b: Bucket) => void) => {
    const b = map.get(key) ?? empty();
    f(b);
    map.set(key, b);
  };
  for (const r of sold) {
    const f = (b: Bucket) => {
      b.qtySold += r.qty;
      b.sales += BigInt(r.amount);
      b.cogs += BigInt(r.cogs);
    };
    add(byDay, r.day, f);
    add(byProduct, r.productId, f);
    add(byCategory, info.get(r.productId)?.category ?? "No category", f);
    f(total);
  }
  for (const r of back) {
    const f = (b: Bucket) => {
      b.qtyBack += r.qty;
      b.returns += BigInt(r.amount);
      b.back += BigInt(r.cost);
    };
    add(byDay, r.day, f);
    add(byProduct, r.productId, f);
    add(byCategory, info.get(r.productId)?.category ?? "No category", f);
    f(total);
  }
  return {
    from,
    to,
    salesCount: counts?.n ?? 0,
    total: toFigures(total),
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, b]) => ({ day, ...toFigures(b) })),
    byCategory: [...byCategory].sort(([a], [b]) => a.localeCompare(b)).map(([category, b]) => ({ category, ...toFigures(b) })),
    byProduct: [...byProduct]
      .map(([id, b]) => ({ product: info.get(id) ?? { id, sku: "", name: "", unit: "", category: null }, ...toFigures(b) }))
      .sort((a, b) => (a.net === b.net ? a.product.name.localeCompare(b.product.name) : a.net > b.net ? -1 : 1)),
  };
}

/** The best sellers in a range by net sales. */
export async function topItems(from: BusinessDate, to: BusinessDate, limit = 10, db: Db | Tx = getDb()) {
  return (await salesReport(from, to, db)).byProduct.filter((p) => p.net > 0n).slice(0, limit);
}

/**
 * Slow movers: active products in stock that sold the fewest units (net of returns) in the range,
 * with their stock and the date they last sold.
 */
export async function slowMovers(from: BusinessDate, to: BusinessDate, limit = 20, db: Db | Tx = getDb()) {
  const report = await salesReport(from, to, db);
  const soldQty = new Map(report.byProduct.map((p) => [p.product.id, p.qty]));
  const stocked = await db
    .select({ id: products.id, sku: products.sku, name: products.name, unit: products.unit, qty: stockBalances.qty, value: stockBalances.value })
    .from(products)
    .innerJoin(stockBalances, eq(stockBalances.productId, products.id))
    .where(and(eq(products.isActive, true), sql`${stockBalances.qty} > 0`))
    .orderBy(asc(products.name));
  const lastSold = await db
    .select({ productId: saleLines.productId, last: sql<string>`max(${sales.saleDate})::text` })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(sales.status, "COMPLETED"), lte(sales.saleDate, to)))
    .groupBy(saleLines.productId);
  const last = new Map(lastSold.map((l) => [l.productId, l.last]));
  return stocked
    .map((p) => ({ product: { id: p.id, sku: p.sku, name: p.name, unit: p.unit }, onHand: p.qty, value: p.value, soldQty: soldQty.get(p.id) ?? 0, lastSold: last.get(p.id) ?? null }))
    .sort((a, b) => a.soldQty - b.soldQty || (a.value === b.value ? a.product.name.localeCompare(b.product.name) : a.value > b.value ? -1 : 1))
    .slice(0, limit);
}
