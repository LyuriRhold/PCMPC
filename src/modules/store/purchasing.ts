import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { addDays, businessToday, now } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { createDv } from "@/modules/cashiering/service";
import { disbursementVouchers } from "@/modules/cashiering/schema";
import { accountIdFor, postJournal } from "@/modules/ledger/service";
import { poLines, products, purchaseOrders, receivingReports, rrLines, suppliers, type PoStatus, type RrPayment } from "./schema";
import { pendingSupplierPayments, planStockMoves, recordStockMoves, StoreError, supplierBalance } from "./service";

/**
 * Purchasing (PHASE-12 T12.4): purchase orders (store clerk prepares, manager approves), receiving
 * reports that post the delivery into stock and the GL (Dr Merchandise Inventory / Cr AP–Trade
 * tagged with the supplier), and supplier payments by disbursement voucher (Dr AP–Trade / Cr Cash
 * or Cash in Bank when the teller releases it).
 */

async function activeSupplier(tx: Tx, supplierId: string) {
  const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!s) throw new StoreError("Supplier not found");
  if (!s.isActive) throw new StoreError(`${s.name} is inactive`);
  return s;
}

async function activeProducts(tx: Tx, ids: string[]) {
  const rows = ids.length ? await tx.select().from(products).where(inArray(products.id, [...new Set(ids)])) : [];
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) throw new StoreError("Product not found");
    if (!p.isActive) throw new StoreError(`${p.sku} ${p.name} is inactive`);
  }
  return byId;
}

/** Line limits keep quantities and amounts well inside the database's ranges. */
const MAX_QTY = 1_000_000;
const MAX_UNIT_COST = 1_000_000_000n; // ₱10,000,000.00

function checkLine(l: { qty: number; unitCost: Money }, i: number) {
  if (!Number.isSafeInteger(l.qty) || l.qty <= 0 || l.qty > MAX_QTY) throw new StoreError(`Line ${i + 1}: the quantity is a whole number from 1 to 1,000,000`);
  if (l.unitCost < 0n) throw new StoreError(`Line ${i + 1}: the unit cost can't be negative`);
  if (l.unitCost > MAX_UNIT_COST) throw new StoreError(`Line ${i + 1}: the unit cost is more than ${format(MAX_UNIT_COST)}`);
}

// ── Purchase orders ──

export type PoLineInput = { productId: string; qty: number; unitCost: Money };

/** The store clerk prepares a purchase order (DRAFT). */
export async function createPo(tx: Tx, input: { supplierId: string; remarks: string | null; lines: PoLineInput[] }, clerkId: string) {
  const supplier = await activeSupplier(tx, input.supplierId);
  if (input.lines.length === 0) throw new StoreError("Add at least one product");
  input.lines.forEach(checkLine);
  await activeProducts(
    tx,
    input.lines.map((l) => l.productId),
  );
  const total = input.lines.reduce((s, l) => s + BigInt(l.qty) * l.unitCost, 0n);
  const today = businessToday();
  const poNo = await nextNumber("PO", tx, today);
  const [po] = await tx
    .insert(purchaseOrders)
    .values({ poNo, supplierId: supplier.id, poDate: today, remarks: input.remarks?.trim() || null, total, preparedBy: clerkId, createdBy: clerkId })
    .returning();
  if (!po) throw new Error("purchase order insert returned no row");
  await tx.insert(poLines).values(input.lines.map((l, i) => ({ poId: po.id, lineNo: i + 1, productId: l.productId, qty: l.qty, unitCost: l.unitCost, lineTotal: BigInt(l.qty) * l.unitCost, createdBy: clerkId })));
  await audit(tx, { action: "store.po_create", entity: "purchase_order", entityId: po.id, after: { poNo, supplier: supplier.name, total: format(total), lines: input.lines.length }, userId: clerkId });
  return { id: po.id, poNo };
}

async function lockPo(tx: Tx, poId: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).for("update");
  if (!po) throw new StoreError("Purchase order not found");
  return po;
}

/** The manager approves a DRAFT purchase order (not the one who prepared it). */
export async function approvePo(tx: Tx, input: { poId: string }, managerId: string) {
  const po = await lockPo(tx, input.poId);
  if (po.status !== "DRAFT") throw new StoreError(`${po.poNo} is already ${po.status}`);
  assertNotSameUser(po.preparedBy, managerId);
  await tx.update(purchaseOrders).set({ status: "APPROVED", approvedBy: managerId, approvedAt: now() }).where(eq(purchaseOrders.id, po.id));
  await audit(tx, { action: "store.po_approve", entity: "purchase_order", entityId: po.id, after: { poNo: po.poNo, total: format(po.total) }, userId: managerId });
}

/** Cancels a purchase order not fully received (what was received stays received). */
export async function cancelPo(tx: Tx, input: { poId: string; reason: string }, managerId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new StoreError("Enter why the purchase order is cancelled");
  const po = await lockPo(tx, input.poId);
  if (po.status === "RECEIVED" || po.status === "CANCELLED") throw new StoreError(`${po.poNo} is ${po.status}`);
  await tx.update(purchaseOrders).set({ status: "CANCELLED", cancelReason: reason }).where(eq(purchaseOrders.id, po.id));
  await audit(tx, { action: "store.po_cancel", entity: "purchase_order", entityId: po.id, before: { status: po.status }, after: { poNo: po.poNo, reason }, userId: managerId });
}

export async function listPos(filter: { status?: PoStatus } = {}, db: Db | Tx = getDb()) {
  return db
    .select({ po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(filter.status ? eq(purchaseOrders.status, filter.status) : undefined)
    .orderBy(desc(purchaseOrders.poDate), desc(purchaseOrders.poNo))
    .limit(200);
}

/** A purchase order with its lines (ordered, received, still to come) and its receiving reports. */
export async function getPo(poId: string, db: Db | Tx = getDb()) {
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, poId));
  if (!row) return null;
  const lines = await db
    .select({ line: poLines, product: { id: products.id, sku: products.sku, name: products.name, unit: products.unit } })
    .from(poLines)
    .innerJoin(products, eq(products.id, poLines.productId))
    .where(eq(poLines.poId, poId))
    .orderBy(asc(poLines.lineNo));
  const rrs = await db.select().from(receivingReports).where(eq(receivingReports.poId, poId)).orderBy(asc(receivingReports.rrNo));
  return { ...row, lines: lines.map((l) => ({ ...l, remaining: l.line.qty - l.line.qtyReceived })), rrs };
}

// ── Receiving ──

export type RrLineInput = { productId: string; poLineId: string | null; qty: number; unitCost: Money };

/**
 * A delivery received into stock: the receiving report, the stock moves (moving average) and one
 * Purchases Journal entry (Dr Merchandise Inventory / Cr AP–Trade tagged with the supplier). Against
 * a PO, each line must be one of its lines and not more than is still to come. A CASH delivery also
 * gets a supplier-payment DV (prepared now; approved by the manager and paid from a teller's
 * drawer), so the cash leaves through the counter (CONFIRM Q-12.4).
 */
export async function receive(tx: Tx, input: { supplierId: string; poId: string | null; invoiceNo: string | null; payment: RrPayment; lines: RrLineInput[] }, clerkId: string) {
  const supplier = await activeSupplier(tx, input.supplierId);
  if (input.lines.length === 0) throw new StoreError("Add at least one product");
  input.lines.forEach(checkLine);
  const byProduct = await activeProducts(
    tx,
    input.lines.map((l) => l.productId),
  );

  if (input.poId) {
    const po = await lockPo(tx, input.poId);
    if (po.supplierId !== supplier.id) throw new StoreError(`${po.poNo} is for another supplier`);
    if (po.status !== "APPROVED" && po.status !== "PARTIAL") throw new StoreError(po.status === "DRAFT" ? `${po.poNo} isn't approved yet` : `${po.poNo} is ${po.status}`);
    const lines = await tx.select().from(poLines).where(eq(poLines.poId, po.id)).for("update");
    const byId = new Map(lines.map((l) => [l.id, l]));
    const receiving = new Map<string, number>();
    input.lines.forEach((l, i) => {
      const pl = l.poLineId ? byId.get(l.poLineId) : undefined;
      if (!pl) throw new StoreError(`Line ${i + 1}: choose a line of ${po.poNo}`);
      if (pl.productId !== l.productId) throw new StoreError(`Line ${i + 1}: the product differs from ${po.poNo} line ${pl.lineNo}`);
      receiving.set(pl.id, (receiving.get(pl.id) ?? 0) + l.qty);
    });
    for (const [lineId, qty] of receiving) {
      const pl = byId.get(lineId)!;
      const left = pl.qty - pl.qtyReceived;
      if (qty > left) throw new StoreError(`${byProduct.get(pl.productId)?.name ?? "A product"}: only ${left} still to come on ${po.poNo}`);
      await tx.update(poLines).set({ qtyReceived: pl.qtyReceived + qty }).where(eq(poLines.id, lineId));
    }
    const done = lines.every((l) => l.qtyReceived + (receiving.get(l.id) ?? 0) === l.qty);
    await tx.update(purchaseOrders).set({ status: done ? "RECEIVED" : "PARTIAL" }).where(eq(purchaseOrders.id, po.id));
  } else if (input.lines.some((l) => l.poLineId)) {
    throw new StoreError("Lines of a purchase order are received against that order");
  }

  const total = input.lines.reduce((s, l) => s + BigInt(l.qty) * l.unitCost, 0n);
  if (total <= 0n) throw new StoreError("The delivery's total must be more than zero");
  const invoiceNo = input.invoiceNo?.trim() || null;
  if (invoiceNo) {
    const [dup] = await tx
      .select({ rrNo: receivingReports.rrNo })
      .from(receivingReports)
      .where(and(eq(receivingReports.supplierId, supplier.id), sql`lower(${receivingReports.invoiceNo}) = lower(${invoiceNo})`));
    if (dup) throw new StoreError(`${supplier.name}'s invoice ${invoiceNo} is already received (${dup.rrNo})`);
  }
  const today = businessToday();
  const rrId = randomUUID();
  const rrNo = await nextNumber("RR", tx, today);
  const plans = await planStockMoves(
    tx,
    input.lines.map((l) => ({ productId: l.productId, type: "RECEIVE" as const, qty: l.qty, cost: BigInt(l.qty) * l.unitCost })),
  );
  const ap = await accountIdFor("accounts_payable_trade", tx);
  const je = await postJournal(
    tx,
    {
      date: today,
      book: "PJ",
      particulars: `${rrNo} · ${supplier.name}${invoiceNo ? ` · invoice ${invoiceNo}` : ""}${input.payment === "CASH" ? " · cash" : ""}`,
      reference: invoiceNo ?? rrNo,
      source: { module: "store", id: rrId },
      lines: [
        { accountId: await accountIdFor("merchandise_inventory", tx), debit: total, memo: rrNo },
        { accountId: ap, credit: total, supplierId: supplier.id, memo: rrNo },
      ],
    },
    clerkId,
  );
  const dv =
    input.payment === "CASH"
      ? await createDv(tx, { date: today, payee: supplier.name, particulars: `Cash payment of ${rrNo}${invoiceNo ? ` (invoice ${invoiceNo})` : ""}`, mode: "CASH", checkNo: null, lines: [{ accountId: ap, memberId: null, supplierId: supplier.id, amount: total, memo: rrNo }] }, clerkId)
      : null;
  await tx.insert(receivingReports).values({
    id: rrId,
    rrNo,
    supplierId: supplier.id,
    poId: input.poId,
    rrDate: today,
    invoiceNo,
    payment: input.payment,
    total,
    dueDate: input.payment === "CASH" ? today : addDays(today, supplier.termsDays),
    dvId: dv?.id ?? null,
    receivedBy: clerkId,
    jeId: je.id,
    createdBy: clerkId,
  });
  await tx.insert(rrLines).values(input.lines.map((l, i) => ({ rrId, lineNo: i + 1, productId: l.productId, poLineId: l.poLineId, qty: l.qty, unitCost: l.unitCost, lineTotal: BigInt(l.qty) * l.unitCost, createdBy: clerkId })));
  await recordStockMoves(tx, plans, { date: today, refType: "RR", refId: rrId, jeId: je.id }, clerkId);
  await audit(tx, { action: "store.receive", entity: "receiving_report", entityId: rrId, after: { rrNo, supplier: supplier.name, total: format(total), payment: input.payment, dvNo: dv?.dvNo ?? null }, userId: clerkId });
  return { id: rrId, rrNo, jeId: je.id, dvNo: dv?.dvNo ?? null };
}

export async function listRrs(db: Db | Tx = getDb()) {
  return db
    .select({ rr: receivingReports, supplier: suppliers.name })
    .from(receivingReports)
    .innerJoin(suppliers, eq(suppliers.id, receivingReports.supplierId))
    .orderBy(desc(receivingReports.rrDate), desc(receivingReports.rrNo))
    .limit(200);
}

/** A receiving report with its lines, PO and payment voucher. */
export async function getRr(rrId: string, db: Db | Tx = getDb()) {
  const [row] = await db.select({ rr: receivingReports, supplier: suppliers }).from(receivingReports).innerJoin(suppliers, eq(suppliers.id, receivingReports.supplierId)).where(eq(receivingReports.id, rrId));
  if (!row) return null;
  const lines = await db
    .select({ line: rrLines, product: { id: products.id, sku: products.sku, name: products.name, unit: products.unit } })
    .from(rrLines)
    .innerJoin(products, eq(products.id, rrLines.productId))
    .where(eq(rrLines.rrId, rrId))
    .orderBy(asc(rrLines.lineNo));
  const [po] = row.rr.poId ? await db.select({ id: purchaseOrders.id, poNo: purchaseOrders.poNo }).from(purchaseOrders).where(eq(purchaseOrders.id, row.rr.poId)) : [];
  const [dv] = row.rr.dvId ? await db.select({ id: disbursementVouchers.id, dvNo: disbursementVouchers.dvNo, status: disbursementVouchers.status }).from(disbursementVouchers).where(eq(disbursementVouchers.id, row.rr.dvId)) : [];
  return { ...row, lines, po: po ?? null, dv: dv ?? null };
}

// ── Supplier payments ──

/**
 * A supplier payment voucher (the bookkeeper prepares it; the manager approves; a teller releases it
 * from the drawer, or by check): Dr AP–Trade (the supplier) / Cr Cash on Hand or Cash in Bank. Not
 * more than the supplier is owed less payments already prepared.
 */
export async function paySupplier(tx: Tx, input: { supplierId: string; amount: Money; mode: "CASH" | "CHECK"; checkNo: string | null; particulars: string | null }, preparerId: string) {
  const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).for("update");
  if (!s) throw new StoreError("Supplier not found");
  if (input.amount <= 0n) throw new StoreError("The amount must be more than zero");
  const owed = (await supplierBalance(s.id, tx)) - (await pendingSupplierPayments(s.id, tx));
  if (input.amount > owed) throw new StoreError(`${s.name} is owed ${format(owed > 0n ? owed : 0n)} (after payments already prepared)`);
  const dv = await createDv(
    tx,
    {
      date: businessToday(),
      payee: s.name,
      particulars: input.particulars?.trim() || `Payment to ${s.name}`,
      mode: input.mode,
      checkNo: input.checkNo,
      lines: [{ accountId: await accountIdFor("accounts_payable_trade", tx), memberId: null, supplierId: s.id, amount: input.amount, memo: "Supplier payment" }],
    },
    preparerId,
  );
  await audit(tx, { action: "store.supplier_payment", entity: "supplier", entityId: s.id, after: { dvNo: dv.dvNo, amount: format(input.amount), mode: input.mode }, userId: preparerId });
  return { dvId: dv.id, dvNo: dv.dvNo };
}

/** Approved purchase orders still to be received (for the receiving screen). */
export async function openPos(db: Db | Tx = getDb()) {
  return db
    .select({ po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(inArray(purchaseOrders.status, ["APPROVED", "PARTIAL"])))
    .orderBy(asc(purchaseOrders.poNo));
}
