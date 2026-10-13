import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { businessToday } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { disbursementVouchers, dvLines } from "@/modules/cashiering/schema";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal } from "@/modules/ledger/service";
import {
  productCategories,
  productPriceHistory,
  products,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockMoves,
  suppliers,
  VAT_CLASSES,
  type MoveType,
  type Product,
  type VatClass,
} from "./schema";
import { averageCost, costOf, EMPTY_STOCK, issueStock, receiveStock, StockError, type StockBalance } from "./stock";

/**
 * The store's item master, suppliers and stock ledger (PHASE-12). Every stock movement is planned
 * against the locked balances (moving average, never below zero), then recorded with the entry it
 * belongs to, in the same transaction.
 */

/** A store rule was broken; the message is safe to show. */
export class StoreError extends Error {
  override name = "StoreError";
}

export { StockError };

const clean = (s: string | null | undefined) => (s ?? "").trim();

// ── Categories ──

export async function createCategory(tx: Tx, input: { name: string }, actorId: string) {
  const name = clean(input.name);
  if (!name) throw new StoreError("Enter the category name");
  const [dup] = await tx.select({ id: productCategories.id }).from(productCategories).where(sql`lower(${productCategories.name}) = lower(${name})`);
  if (dup) throw new StoreError(`Category "${name}" already exists`);
  const [c] = await tx.insert(productCategories).values({ name, createdBy: actorId }).returning();
  if (!c) throw new Error("category insert returned no row");
  await audit(tx, { action: "store.category_create", entity: "product_category", entityId: c.id, after: { name }, userId: actorId });
  return { id: c.id };
}

export async function updateCategory(tx: Tx, input: { id: string; name: string; isActive: boolean }, actorId: string) {
  const name = clean(input.name);
  if (!name) throw new StoreError("Enter the category name");
  const [before] = await tx.select().from(productCategories).where(eq(productCategories.id, input.id)).for("update");
  if (!before) throw new StoreError("Category not found");
  const [dup] = await tx
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(sql`lower(${productCategories.name}) = lower(${name})`, sql`${productCategories.id} <> ${input.id}`));
  if (dup) throw new StoreError(`Category "${name}" already exists`);
  await tx.update(productCategories).set({ name, isActive: input.isActive }).where(eq(productCategories.id, input.id));
  await audit(tx, { action: "store.category_update", entity: "product_category", entityId: input.id, before: { name: before.name, isActive: before.isActive }, after: { name, isActive: input.isActive }, userId: actorId });
}

export async function listCategories(db: Db | Tx = getDb()) {
  return db.select().from(productCategories).orderBy(asc(productCategories.name));
}

// ── Products and prices ──

export type ProductInput = {
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  categoryId: string | null;
  reorderLevel: number;
  vatClass: VatClass;
};

async function checkProduct(tx: Tx, input: ProductInput, selfId: string | null) {
  const sku = clean(input.sku).toUpperCase();
  const barcode = clean(input.barcode) || null;
  const name = clean(input.name);
  const unit = clean(input.unit);
  if (!sku) throw new StoreError("Enter the SKU");
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku)) throw new StoreError("The SKU uses letters, digits, dot, dash or underscore (up to 40)");
  if (barcode && !/^[0-9A-Za-z-]{4,40}$/.test(barcode)) throw new StoreError("The barcode uses 4 to 40 letters or digits");
  if (!name) throw new StoreError("Enter the product name");
  if (!unit) throw new StoreError("Enter the unit (pc, pack, sack, kg)");
  if (!Number.isSafeInteger(input.reorderLevel) || input.reorderLevel < 0) throw new StoreError("The reorder level is a whole number, 0 or more");
  if (!VAT_CLASSES.includes(input.vatClass)) throw new StoreError("Choose the VAT class");
  if (input.categoryId) {
    const [c] = await tx.select().from(productCategories).where(eq(productCategories.id, input.categoryId));
    if (!c || (!c.isActive && !selfId)) throw new StoreError("Choose an active category");
  }
  const others = await tx
    .select({ id: products.id, sku: products.sku, barcode: products.barcode })
    .from(products)
    .where(barcode ? or(eq(products.sku, sku), eq(products.barcode, barcode)) : eq(products.sku, sku));
  for (const o of others) {
    if (o.id === selfId) continue;
    if (o.sku === sku) throw new StoreError(`SKU ${sku} is already used`);
    if (barcode && o.barcode === barcode) throw new StoreError(`Barcode ${barcode} is already used`);
  }
  return { sku, barcode, name, unit, categoryId: input.categoryId, reorderLevel: input.reorderLevel, vatClass: input.vatClass };
}

/** A new product with its selling price (store.price): the first price-history row and an empty stock balance. */
export async function createProduct(tx: Tx, input: ProductInput & { sellingPrice: Money }, actorId: string) {
  const fields = await checkProduct(tx, input, null);
  if (input.sellingPrice < 0n) throw new StoreError("The selling price can't be negative");
  const [p] = await tx
    .insert(products)
    .values({ ...fields, sellingPrice: input.sellingPrice, createdBy: actorId })
    .returning();
  if (!p) throw new Error("product insert returned no row");
  await tx.insert(productPriceHistory).values({ productId: p.id, price: input.sellingPrice, by: actorId, createdBy: actorId });
  await tx.insert(stockBalances).values({ productId: p.id, createdBy: actorId });
  await audit(tx, { action: "store.product_create", entity: "product", entityId: p.id, after: { sku: p.sku, name: p.name, price: format(input.sellingPrice) }, userId: actorId });
  return { id: p.id };
}

/** Edits a product's details (not its price, which has its own history). */
export async function updateProduct(tx: Tx, input: ProductInput & { id: string; isActive: boolean }, actorId: string) {
  const [before] = await tx.select().from(products).where(eq(products.id, input.id)).for("update");
  if (!before) throw new StoreError("Product not found");
  const fields = await checkProduct(tx, input, input.id);
  await tx.update(products).set({ ...fields, isActive: input.isActive }).where(eq(products.id, input.id));
  await audit(tx, {
    action: "store.product_update",
    entity: "product",
    entityId: input.id,
    before: { sku: before.sku, barcode: before.barcode, name: before.name, unit: before.unit, categoryId: before.categoryId, reorderLevel: before.reorderLevel, vatClass: before.vatClass, isActive: before.isActive },
    after: { ...fields, isActive: input.isActive },
    userId: actorId,
  });
}

/** A new selling price (store.price), kept in the price history. */
export async function changePrice(tx: Tx, input: { productId: string; price: Money }, actorId: string) {
  if (input.price < 0n) throw new StoreError("The selling price can't be negative");
  const [p] = await tx.select().from(products).where(eq(products.id, input.productId)).for("update");
  if (!p) throw new StoreError("Product not found");
  if (p.sellingPrice === input.price) throw new StoreError(`${p.name} already sells at ${format(input.price)}`);
  await tx.update(products).set({ sellingPrice: input.price }).where(eq(products.id, p.id));
  await tx.insert(productPriceHistory).values({ productId: p.id, price: input.price, by: actorId, createdBy: actorId });
  await audit(tx, { action: "store.price_change", entity: "product", entityId: p.id, before: { price: format(p.sellingPrice) }, after: { price: format(input.price) }, userId: actorId });
}

/** Products with their stock, by name; `q` matches the SKU, barcode or name. */
export async function listProducts(filter: { q?: string; categoryId?: string; activeOnly?: boolean } = {}, db: Db | Tx = getDb()) {
  const q = clean(filter.q);
  const where = and(
    q ? or(ilike(products.name, `%${q}%`), ilike(products.sku, `%${q}%`), eq(products.barcode, q)) : undefined,
    filter.categoryId ? eq(products.categoryId, filter.categoryId) : undefined,
    filter.activeOnly ? eq(products.isActive, true) : undefined,
  );
  return db
    .select({ product: products, category: productCategories.name, qty: stockBalances.qty, avgCost: stockBalances.avgCost, value: stockBalances.value })
    .from(products)
    .innerJoin(stockBalances, eq(stockBalances.productId, products.id))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(where)
    .orderBy(asc(products.name));
}

/** One product with its stock balance and price history (newest first). */
export async function getProduct(productId: string, db: Db | Tx = getDb()) {
  const [row] = await db
    .select({ product: products, category: productCategories.name })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(eq(products.id, productId));
  if (!row) return null;
  const prices = await db.select().from(productPriceHistory).where(eq(productPriceHistory.productId, productId)).orderBy(sql`${productPriceHistory.effectiveAt} DESC`);
  return { ...row, balance: await stockBalance(productId, db), prices };
}

// ── Suppliers ──

export type SupplierInput = { name: string; contact: string | null; tin: string | null; termsDays: number };

async function checkSupplier(tx: Tx, input: SupplierInput, selfId: string | null) {
  const name = clean(input.name);
  if (!name) throw new StoreError("Enter the supplier name");
  if (!Number.isSafeInteger(input.termsDays) || input.termsDays < 0 || input.termsDays > 365) throw new StoreError("Terms are 0 to 365 days");
  const tin = clean(input.tin) || null;
  if (tin && !/^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/.test(tin)) throw new StoreError("Enter the TIN as 000-000-000 or 000-000-000-000");
  const [dup] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name})`);
  if (dup && dup.id !== selfId) throw new StoreError(`Supplier "${name}" already exists`);
  return { name, contact: clean(input.contact) || null, tin, termsDays: input.termsDays };
}

export async function createSupplier(tx: Tx, input: SupplierInput, actorId: string) {
  const fields = await checkSupplier(tx, input, null);
  const [s] = await tx.insert(suppliers).values({ ...fields, createdBy: actorId }).returning();
  if (!s) throw new Error("supplier insert returned no row");
  await audit(tx, { action: "store.supplier_create", entity: "supplier", entityId: s.id, after: fields, userId: actorId });
  return { id: s.id };
}

export async function updateSupplier(tx: Tx, input: SupplierInput & { id: string; isActive: boolean }, actorId: string) {
  const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, input.id)).for("update");
  if (!before) throw new StoreError("Supplier not found");
  const fields = await checkSupplier(tx, input, input.id);
  await tx.update(suppliers).set({ ...fields, isActive: input.isActive }).where(eq(suppliers.id, input.id));
  await audit(tx, { action: "store.supplier_update", entity: "supplier", entityId: input.id, before: { name: before.name, contact: before.contact, tin: before.tin, termsDays: before.termsDays, isActive: before.isActive }, after: { ...fields, isActive: input.isActive }, userId: actorId });
}

/** Suppliers by name, with what the store owes each (AP–Trade). */
export async function listSuppliers(db: Db | Tx = getDb()) {
  const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
  const balances = await supplierBalances(db);
  return rows.map((s) => ({ supplier: s, balance: balances.get(s.id) ?? 0n }));
}

export async function getSupplier(supplierId: string, db: Db | Tx = getDb()) {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  return s ?? null;
}

const apLines = (db: Db | Tx, supplierId?: string) =>
  db
    .select({ supplierId: journalLines.supplierId, balance: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, and(eq(accountMappings.accountId, journalLines.accountId), eq(accountMappings.key, "accounts_payable_trade")))
    .where(and(inArray(journalEntries.status, ["POSTED", "REVERSED"]), supplierId ? eq(journalLines.supplierId, supplierId) : sql`${journalLines.supplierId} IS NOT NULL`));

/** What the store owes each supplier: AP–Trade credits less debits on the supplier's lines. */
export async function supplierBalances(db: Db | Tx = getDb()): Promise<Map<string, Money>> {
  const rows = await apLines(db).groupBy(journalLines.supplierId);
  return new Map(rows.filter((r) => r.supplierId).map((r) => [r.supplierId as string, BigInt(r.balance)]));
}

/** What the store owes one supplier (AP–Trade sub-ledger). */
export async function supplierBalance(supplierId: string, db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await apLines(db, supplierId).groupBy(journalLines.supplierId);
  return BigInt(r?.balance ?? "0");
}

/** Supplier payments prepared but not yet released (DVs in DRAFT or APPROVED). */
export async function pendingSupplierPayments(supplierId: string, db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${dvLines.amount}), 0)::text` })
    .from(dvLines)
    .innerJoin(disbursementVouchers, eq(disbursementVouchers.id, dvLines.dvId))
    .where(and(eq(dvLines.supplierId, supplierId), inArray(disbursementVouchers.status, ["DRAFT", "APPROVED"])));
  return BigInt(r?.s ?? "0");
}

// ── The stock ledger ──

const toBalance = (r: { qty: number; avgCost: string; value: Money }): StockBalance => ({ qty: r.qty, avgCost: r.avgCost, value: r.value });

/** A product's stock on hand: quantity, moving-average unit cost (4 decimals) and value. */
export async function stockBalance(productId: string, db: Db | Tx = getDb()): Promise<StockBalance> {
  const [b] = await db.select().from(stockBalances).where(eq(stockBalances.productId, productId));
  return b ? toBalance(b) : EMPTY_STOCK;
}

/** One planned movement: + receives `cost` (centavos; at the current average cost when not given); − issues at the moving average. */
export type StockMoveInput = { productId: string; type: MoveType; qty: number; cost?: Money };
export type PlannedMove = StockMoveInput & { totalCost: Money; unitCost: string; after: StockBalance; product: Pick<Product, "id" | "sku" | "name" | "isActive"> };

/**
 * Plans movements against the products' balances, locked in product order (so concurrent postings
 * can't deadlock) and applied in input order (a product can move twice). Issues are costed at the
 * moving average and never take the stock below zero ("Insufficient stock (n)").
 */
export async function planStockMoves(tx: Tx, moves: StockMoveInput[]): Promise<PlannedMove[]> {
  const ids = [...new Set(moves.map((m) => m.productId))].sort();
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ balance: stockBalances, product: { id: products.id, sku: products.sku, name: products.name, isActive: products.isActive } })
    .from(stockBalances)
    .innerJoin(products, eq(products.id, stockBalances.productId))
    .where(inArray(stockBalances.productId, ids))
    .orderBy(asc(stockBalances.productId))
    .for("update", { of: stockBalances });
  const current = new Map(rows.map((r) => [r.product.id, { balance: toBalance(r.balance), product: r.product }]));
  return moves.map((m) => {
    const c = current.get(m.productId);
    if (!c) throw new StoreError("Product not found");
    let totalCost: Money;
    let unitCost: string;
    let after: StockBalance;
    if (m.qty > 0) {
      const cost = m.cost ?? costOf(m.qty, c.balance.avgCost);
      after = receiveStock(c.balance, m.qty, cost);
      totalCost = cost;
      unitCost = m.cost === undefined ? c.balance.avgCost : averageCost(cost, m.qty);
    } else {
      let out: ReturnType<typeof issueStock>;
      try {
        out = issueStock(c.balance, -m.qty);
      } catch (e) {
        if (e instanceof StockError) throw new StockError(`${c.product.sku} ${c.product.name}: ${e.message}`);
        throw e;
      }
      after = out.balance;
      totalCost = -out.cogs;
      unitCost = c.balance.avgCost;
    }
    c.balance = after;
    return { ...m, totalCost, unitCost, after, product: c.product };
  });
}

/** Writes planned movements (after their entry exists) and the products' new balances. */
export async function recordStockMoves(tx: Tx, plans: PlannedMove[], ctx: { date: string; refType: string; refId: string; jeId: string | null }, actorId: string | null) {
  if (plans.length === 0) return;
  await tx.insert(stockMoves).values(
    plans.map((p) => ({
      productId: p.productId,
      moveDate: ctx.date,
      type: p.type,
      qty: p.qty,
      unitCost: p.unitCost,
      totalCost: p.totalCost,
      qtyAfter: p.after.qty,
      avgCostAfter: p.after.avgCost,
      valueAfter: p.after.value,
      refType: ctx.refType,
      refId: ctx.refId,
      jeId: ctx.jeId,
      createdBy: actorId,
    })),
  );
  const last = new Map<string, StockBalance>();
  for (const p of plans) last.set(p.productId, p.after);
  for (const [productId, b] of last) {
    await tx.update(stockBalances).set({ qty: b.qty, avgCost: b.avgCost, value: b.value, updatedAt: sql`now()` }).where(eq(stockBalances.productId, productId));
  }
}

// ── Stock counts (T12.5) ──

async function lockCount(tx: Tx, countId: string) {
  const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, countId)).for("update");
  if (!c) throw new StoreError("Stock count not found");
  return c;
}

/**
 * The store clerk starts a count sheet: the chosen products, else a category's, else all products
 * that are active or still have stock. A product is on one open (draft or submitted) count at a
 * time, so a variance is never posted twice.
 */
export async function createCount(tx: Tx, input: { productIds: string[]; categoryId?: string | null; remarks: string | null }, clerkId: string) {
  const ids = [...new Set(input.productIds)];
  const chosen = ids.length
    ? await tx.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.id, ids))
    : await tx
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .innerJoin(stockBalances, eq(stockBalances.productId, products.id))
        .where(and(or(eq(products.isActive, true), sql`${stockBalances.qty} > 0`), input.categoryId ? eq(products.categoryId, input.categoryId) : undefined));
  if (ids.length && chosen.length !== ids.length) throw new StoreError("Product not found");
  if (chosen.length === 0) throw new StoreError("There are no products to count");
  // Lock the products' balances (in order) so two sheets for the same product can't start at once.
  await tx
    .select({ id: stockBalances.id })
    .from(stockBalances)
    .where(inArray(stockBalances.productId, chosen.map((p) => p.id)))
    .orderBy(asc(stockBalances.productId))
    .for("update");
  const open = await tx
    .select({ sku: products.sku, countNo: stockCounts.countNo })
    .from(stockCountLines)
    .innerJoin(stockCounts, eq(stockCounts.id, stockCountLines.countId))
    .innerJoin(products, eq(products.id, stockCountLines.productId))
    .where(and(inArray(stockCountLines.productId, chosen.map((p) => p.id)), inArray(stockCounts.status, ["DRAFT", "SUBMITTED"])))
    .orderBy(asc(products.sku))
    .limit(3);
  if (open.length) throw new StoreError(`Already on an open count: ${open.map((o) => `${o.sku} (${o.countNo})`).join(", ")}; finish or return that count first`);
  const today = businessToday();
  const countNo = await nextNumber("SC", tx, today);
  const [c] = await tx.insert(stockCounts).values({ countNo, countDate: today, remarks: clean(input.remarks) || null, preparedBy: clerkId, createdBy: clerkId }).returning();
  if (!c) throw new Error("stock count insert returned no row");
  await tx.insert(stockCountLines).values(chosen.map((p) => ({ countId: c.id, productId: p.id, createdBy: clerkId })));
  await audit(tx, { action: "store.count_create", entity: "stock_count", entityId: c.id, after: { countNo, products: chosen.length }, userId: clerkId });
  return { id: c.id, countNo };
}

/** Counted quantities on a DRAFT sheet (null clears a line). */
export async function enterCounts(tx: Tx, input: { countId: string; lines: Array<{ productId: string; countedQty: number | null }> }, clerkId: string) {
  const c = await lockCount(tx, input.countId);
  if (c.status !== "DRAFT") throw new StoreError(`${c.countNo} is ${c.status}; counts are entered on a draft`);
  const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, c.id));
  const byProduct = new Map(lines.map((l) => [l.productId, l]));
  for (const l of input.lines) {
    const line = byProduct.get(l.productId);
    if (!line) throw new StoreError(`That product isn't on ${c.countNo}`);
    if (l.countedQty !== null && (!Number.isSafeInteger(l.countedQty) || l.countedQty < 0 || l.countedQty > 10_000_000)) throw new StoreError("A counted quantity is a whole number from 0 to 10,000,000");
    await tx.update(stockCountLines).set({ countedQty: l.countedQty }).where(eq(stockCountLines.id, line.id));
  }
  await audit(tx, { action: "store.count_enter", entity: "stock_count", entityId: c.id, after: { countNo: c.countNo, lines: input.lines.length }, userId: clerkId });
}

/**
 * Submits a counted sheet for approval: the system quantities are taken now (the clerk counts
 * blind) and each line's variance is counted − system. Nothing is posted yet.
 */
export async function submitCount(tx: Tx, input: { countId: string }, clerkId: string) {
  const c = await lockCount(tx, input.countId);
  if (c.status !== "DRAFT") throw new StoreError(`${c.countNo} is already ${c.status}`);
  const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, c.id));
  const missing = lines.filter((l) => l.countedQty === null).length;
  if (missing) throw new StoreError(`Count every product first (${missing} not counted)`);
  const balances = await tx.select().from(stockBalances).where(inArray(stockBalances.productId, lines.map((l) => l.productId)));
  const qtyOf = new Map(balances.map((b) => [b.productId, b.qty]));
  for (const l of lines) {
    const systemQty = qtyOf.get(l.productId) ?? 0;
    await tx.update(stockCountLines).set({ systemQty, variance: (l.countedQty ?? 0) - systemQty }).where(eq(stockCountLines.id, l.id));
  }
  await tx.update(stockCounts).set({ status: "SUBMITTED", submittedAt: sql`now()`, submittedBy: clerkId }).where(eq(stockCounts.id, c.id));
  await audit(tx, { action: "store.count_submit", entity: "stock_count", entityId: c.id, after: { countNo: c.countNo, variances: lines.filter((l) => (l.countedQty ?? 0) !== (qtyOf.get(l.productId) ?? 0)).length }, userId: clerkId });
}

/** What a variance is worth now: a shortage at the moving average (or the remaining value when it empties the stock), an overage at the average cost. */
function varianceValueOf(balance: StockBalance, variance: number): Money {
  if (variance === 0) return 0n;
  // A shortage no longer on the shelf (the stock moved since submission) has nothing left to value.
  if (variance < 0 && balance.qty === 0) return 0n;
  if (variance > 0) return costOf(variance, balance.avgCost);
  return -issueStock(balance, Math.min(-variance, balance.qty)).cogs;
}

/**
 * The manager (not the preparer) approves a submitted count: each variance is posted as a stock
 * adjustment, shortages Dr Inventory Losses / Cr Merchandise Inventory and overages Dr Merchandise
 * Inventory / Cr Inventory Overage (CONFIRM Q-12.5), in one entry.
 */
export async function approveCount(tx: Tx, input: { countId: string }, managerId: string) {
  const c = await lockCount(tx, input.countId);
  if (c.status !== "SUBMITTED") throw new StoreError(c.status === "DRAFT" ? `${c.countNo} isn't submitted yet` : `${c.countNo} is already ${c.status}`);
  assertNotSameUser(c.preparedBy, managerId);
  if (c.submittedBy) assertNotSameUser(c.submittedBy, managerId);
  const lines = (await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, c.id))).filter((l) => (l.variance ?? 0) !== 0);
  // Shortages go out at the moving average; overages come in at it (no cost given).
  const priced = await planStockMoves(
    tx,
    lines.map((l) => ({ productId: l.productId, type: "ADJUST" as const, qty: l.variance ?? 0 })),
  );
  const shortage = priced.filter((p) => p.qty < 0).reduce((s, p) => s - p.totalCost, 0n);
  const overage = priced.filter((p) => p.qty > 0).reduce((s, p) => s + p.totalCost, 0n);
  const today = businessToday();
  let jeId: string | null = null;
  if (shortage > 0n || overage > 0n) {
    const inv = await accountIdFor("merchandise_inventory", tx);
    const je = await postJournal(
      tx,
      {
        date: today,
        book: "GJ",
        particulars: `Stock count ${c.countNo}: ${shortage > 0n ? `shortages ${format(shortage)}` : ""}${shortage > 0n && overage > 0n ? ", " : ""}${overage > 0n ? `overages ${format(overage)}` : ""}`,
        reference: c.countNo,
        source: { module: "store", id: c.id },
        lines: [
          ...(shortage > 0n
            ? [
                { accountId: await accountIdFor("inventory_losses", tx), debit: shortage, memo: c.countNo },
                { accountId: inv, credit: shortage, memo: c.countNo },
              ]
            : []),
          ...(overage > 0n
            ? [
                { accountId: inv, debit: overage, memo: c.countNo },
                { accountId: await accountIdFor("inventory_gains", tx), credit: overage, memo: c.countNo },
              ]
            : []),
        ],
      },
      managerId,
    );
    jeId = je.id;
  }
  await recordStockMoves(tx, priced, { date: today, refType: "COUNT", refId: c.id, jeId }, managerId);
  for (const p of priced) {
    const line = lines.find((l) => l.productId === p.productId);
    if (line) await tx.update(stockCountLines).set({ varianceValue: p.totalCost }).where(eq(stockCountLines.id, line.id));
  }
  await tx.update(stockCounts).set({ status: "APPROVED", approvedBy: managerId, approvedAt: sql`now()`, jeId }).where(eq(stockCounts.id, c.id));
  await audit(tx, { action: "store.count_approve", entity: "stock_count", entityId: c.id, after: { countNo: c.countNo, shortage: format(shortage), overage: format(overage) }, userId: managerId });
  return { jeId, shortage, overage };
}

/** The manager sends a submitted sheet back to the clerk (e.g. a miscount) with a reason; it is a draft again. */
export async function returnCount(tx: Tx, input: { countId: string; reason: string }, managerId: string) {
  const reason = clean(input.reason);
  if (!reason) throw new StoreError("Enter why the count goes back to the clerk");
  const c = await lockCount(tx, input.countId);
  if (c.status !== "SUBMITTED") throw new StoreError(`${c.countNo} is ${c.status}; only a submitted count goes back to the clerk`);
  await tx.update(stockCounts).set({ status: "DRAFT", submittedAt: null, submittedBy: null }).where(eq(stockCounts.id, c.id));
  await tx.update(stockCountLines).set({ systemQty: null, variance: null }).where(eq(stockCountLines.countId, c.id));
  await audit(tx, { action: "store.count_return", entity: "stock_count", entityId: c.id, after: { countNo: c.countNo, reason }, userId: managerId });
}

export async function listCounts(db: Db | Tx = getDb()) {
  return db.select().from(stockCounts).orderBy(sql`${stockCounts.countDate} DESC`, sql`${stockCounts.countNo} DESC`).limit(200);
}

/**
 * A count sheet. Variance values are the posted ones once approved; before that, what each
 * variance would be worth now.
 */
export async function getCount(countId: string, db: Db | Tx = getDb()) {
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, countId));
  if (!c) return null;
  const rows = await db
    .select({ line: stockCountLines, product: { sku: products.sku, name: products.name, unit: products.unit }, balance: stockBalances })
    .from(stockCountLines)
    .innerJoin(products, eq(products.id, stockCountLines.productId))
    .innerJoin(stockBalances, eq(stockBalances.productId, stockCountLines.productId))
    .where(eq(stockCountLines.countId, countId))
    .orderBy(asc(products.name));
  return {
    count: c,
    lines: rows.map(({ line, product, balance }) => ({
      id: line.id,
      productId: line.productId,
      ...product,
      systemQty: line.systemQty,
      countedQty: line.countedQty,
      variance: line.variance,
      varianceValue: line.varianceValue ?? (line.variance === null ? null : varianceValueOf(toBalance(balance), line.variance)),
    })),
  };
}
