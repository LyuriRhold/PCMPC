import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { businessToday, daysBetween, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { bucketFor } from "@/modules/loans/aging";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountBalance, accountIdFor } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import { poLines, productCategories, products, purchaseOrders, receivingReports, stockBalances, stockCounts, stockMoves, suppliers } from "./schema";

/**
 * Store reports (PHASE-12 T12.6): the stock card, inventory valuation (tied to the GL Merchandise
 * Inventory balance), the reorder list and supplier payables aging.
 */

/** A product's stock card: the balance before `from`, each movement in the range with its document, and the balance after it. */
export async function stockCard(productId: string, from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const [before] = await db
    .select({ qty: stockMoves.qtyAfter, avgCost: stockMoves.avgCostAfter, value: stockMoves.valueAfter })
    .from(stockMoves)
    .where(and(eq(stockMoves.productId, productId), lt(stockMoves.moveDate, from)))
    .orderBy(desc(stockMoves.seq))
    .limit(1);
  const moves = await db
    .select()
    .from(stockMoves)
    .where(and(eq(stockMoves.productId, productId), gte(stockMoves.moveDate, from), lte(stockMoves.moveDate, to)))
    .orderBy(asc(stockMoves.seq));
  const rrIds = moves.filter((m) => m.refType === "RR").map((m) => m.refId);
  const countIds = moves.filter((m) => m.refType === "COUNT").map((m) => m.refId);
  const docs = new Map<string, string>();
  if (rrIds.length) for (const r of await db.select({ id: receivingReports.id, no: receivingReports.rrNo }).from(receivingReports).where(inArray(receivingReports.id, rrIds))) docs.set(r.id, r.no);
  if (countIds.length) for (const c of await db.select({ id: stockCounts.id, no: stockCounts.countNo }).from(stockCounts).where(inArray(stockCounts.id, countIds))) docs.set(c.id, c.no);
  const opening = before ?? { qty: 0, avgCost: "0.0000", value: 0n };
  const last = moves.at(-1);
  return {
    opening,
    moves: moves.map((m) => ({ ...m, document: docs.get(m.refId) ?? null })),
    closing: last ? { qty: last.qtyAfter, avgCost: last.avgCostAfter, value: last.valueAfter } : opening,
  };
}

/**
 * Inventory valuation as of a date: each product's quantity, average cost and value after its last
 * movement on or before the date, with the GL Merchandise Inventory balance on the same date (they
 * agree: every valued movement is posted with its entry).
 */
export async function inventoryValuation(asOf: BusinessDate = businessToday(), db: Db | Tx = getDb()) {
  const latest = db
    .selectDistinctOn([stockMoves.productId], { productId: stockMoves.productId, qty: stockMoves.qtyAfter, avgCost: stockMoves.avgCostAfter, value: stockMoves.valueAfter })
    .from(stockMoves)
    .where(lte(stockMoves.moveDate, asOf))
    .orderBy(stockMoves.productId, desc(stockMoves.seq))
    .as("latest");
  const rows = await db
    .select({ product: { id: products.id, sku: products.sku, name: products.name, unit: products.unit }, category: productCategories.name, qty: latest.qty, avgCost: latest.avgCost, value: latest.value })
    .from(latest)
    .innerJoin(products, eq(products.id, latest.productId))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(sql`${latest.qty} > 0 OR ${latest.value} > 0`)
    .orderBy(asc(products.name));
  const total = rows.reduce((s, r) => s + r.value, 0n);
  const gl = await accountBalance(await accountIdFor("merchandise_inventory", db), asOf, db);
  return { asOf, rows, total, glBalance: gl.net, difference: total - gl.net };
}

/** Active products with a reorder level, at or below it, with what is already on order (approved POs still to come). */
export async function reorderList(db: Db | Tx = getDb()) {
  const onOrder = db
    .select({ productId: poLines.productId, qty: sql<number>`sum(${poLines.qty} - ${poLines.qtyReceived})::int`.as("on_order") })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(inArray(purchaseOrders.status, ["APPROVED", "PARTIAL"]))
    .groupBy(poLines.productId)
    .as("on_order_q");
  return db
    .select({ product: products, category: productCategories.name, qty: stockBalances.qty, onOrder: sql<number>`coalesce(${onOrder.qty}, 0)` })
    .from(products)
    .innerJoin(stockBalances, eq(stockBalances.productId, products.id))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(onOrder, eq(onOrder.productId, products.id))
    .where(and(eq(products.isActive, true), sql`${products.reorderLevel} > 0`, sql`${stockBalances.qty} <= ${products.reorderLevel}`))
    .orderBy(asc(products.name));
}

export type ApAgingRow = { supplierId: string; name: string; balance: Money; buckets: Record<string, Money>; oldestDue: BusinessDate | null };

/**
 * What the store owes each supplier as of a date, by days past due. Payments (AP–Trade debits)
 * settle the oldest deliveries first; each delivery is due on its receiving date plus the
 * supplier's terms.
 */
export async function apAging(asOf: BusinessDate = businessToday(), db: Db | Tx = getDb()) {
  const buckets = await getSetting("store.ap_aging_buckets", db);
  const apId = await accountIdFor("accounts_payable_trade", db);
  const totals = await db
    .select({ supplierId: journalLines.supplierId, debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::text`, credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, and(eq(accountMappings.accountId, journalLines.accountId), eq(accountMappings.key, "accounts_payable_trade")))
    .where(and(eq(journalLines.accountId, apId), inArray(journalEntries.status, ["POSTED", "REVERSED"]), lte(journalEntries.entryDate, asOf), sql`${journalLines.supplierId} IS NOT NULL`))
    .groupBy(journalLines.supplierId);
  const owing = totals.filter((t) => BigInt(t.credit) - BigInt(t.debit) !== 0n);
  if (owing.length === 0) return { asOf, buckets: buckets.map((b) => b.label), rows: [] as ApAgingRow[], total: 0n };
  const ids = owing.map((t) => t.supplierId as string);
  const names = new Map((await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, ids))).map((s) => [s.id, s.name]));
  const rrs = await db
    .select({ supplierId: receivingReports.supplierId, total: receivingReports.total, dueDate: receivingReports.dueDate })
    .from(receivingReports)
    .where(and(inArray(receivingReports.supplierId, ids), lte(receivingReports.rrDate, asOf)))
    .orderBy(asc(receivingReports.rrDate), asc(receivingReports.rrNo));
  const rows: ApAgingRow[] = owing.map((t) => {
    const supplierId = t.supplierId as string;
    const balance = BigInt(t.credit) - BigInt(t.debit);
    const row: ApAgingRow = { supplierId, name: names.get(supplierId) ?? "", balance, buckets: Object.fromEntries(buckets.map((b) => [b.label, 0n])), oldestDue: null };
    // Payments settle the oldest deliveries; what is left of the newest ones is still owed.
    let paid = BigInt(t.debit);
    let bucketed = 0n;
    for (const r of rrs.filter((x) => x.supplierId === supplierId)) {
      const settled = paid >= r.total ? r.total : paid;
      paid -= settled;
      const open = r.total - settled;
      if (open === 0n) continue;
      const label = bucketFor(Math.max(0, daysBetween(r.dueDate, asOf)), buckets);
      row.buckets[label] = (row.buckets[label] ?? 0n) + open;
      bucketed += open;
      if (!row.oldestDue || r.dueDate < row.oldestDue) row.oldestDue = r.dueDate;
    }
    // Anything not from a delivery (none in normal use) is shown as not yet due, so the groups add up.
    const first = buckets[0]?.label;
    if (first && balance !== bucketed) row.buckets[first] = (row.buckets[first] ?? 0n) + (balance - bucketed);
    return row;
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { asOf, buckets: buckets.map((b) => b.label), rows, total: rows.reduce((s, r) => s + r.balance, 0n) };
}
