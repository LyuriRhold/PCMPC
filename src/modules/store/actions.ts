"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { parse as parseMoney } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { approvePo, cancelPo, createPo, paySupplier, receive } from "./purchasing";
import { RR_PAYMENTS, VAT_CLASSES } from "./schema";
import { approveCount, changePrice, createCategory, createCount, createProduct, createSupplier, enterCounts, StockError, StoreError, submitCount, updateCategory, updateProduct, updateSupplier } from "./service";

const EXPECTED = [StoreError, StockError, LedgerError, CashieringError];

function pesos(text: string, what = "amount"): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new StoreError(`Enter the ${what} in pesos, e.g. 1,250.00`);
  }
}

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => z.string().trim().max(max).nullable();
const whole = z.number().int().min(0).max(1_000_000);

// ── Categories (store.price) ──

const categorySchema = z.object({ name: text(80) });
export async function createCategoryAction(input: z.input<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("store.price");
  try {
    const data = categorySchema.parse(input);
    return ok(await withTx((tx) => createCategory(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const categoryUpdateSchema = categorySchema.extend({ id, isActive: z.boolean() });
export async function updateCategoryAction(input: z.input<typeof categoryUpdateSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.price");
  try {
    const data = categoryUpdateSchema.parse(input);
    await withTx((tx) => updateCategory(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Products and prices (store.price) ──

const productFields = {
  sku: text(40),
  barcode: optional(40),
  name: text(120),
  unit: text(20),
  categoryId: id.nullable(),
  reorderLevel: whole,
  vatClass: z.enum(VAT_CLASSES),
};

const productSchema = z.object({ ...productFields, sellingPrice: text(20) });
/** Manager: a new product with its selling price. */
export async function createProductAction(input: z.input<typeof productSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("store.price");
  try {
    const data = productSchema.parse(input);
    return ok(await withTx((tx) => createProduct(tx, { ...data, sellingPrice: pesos(data.sellingPrice, "selling price") }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const productUpdateSchema = z.object({ ...productFields, id, isActive: z.boolean() });
/** Manager: edits a product's details (the price has its own action and history). */
export async function updateProductAction(input: z.input<typeof productUpdateSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.price");
  try {
    const data = productUpdateSchema.parse(input);
    await withTx((tx) => updateProduct(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const priceSchema = z.object({ productId: id, price: text(20) });
/** Manager: a new selling price, kept in the price history. */
export async function changePriceAction(input: z.input<typeof priceSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.price");
  try {
    const data = priceSchema.parse(input);
    await withTx((tx) => changePrice(tx, { productId: data.productId, price: pesos(data.price, "selling price") }, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Suppliers (store.receive) ──

const supplierSchema = z.object({ name: text(120), contact: optional(120), tin: optional(20), termsDays: z.number().int() });
/** Store clerk: a new supplier. */
export async function createSupplierAction(input: z.input<typeof supplierSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("store.receive");
  try {
    const data = supplierSchema.parse(input);
    return ok(await withTx((tx) => createSupplier(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const supplierUpdateSchema = supplierSchema.extend({ id, isActive: z.boolean() });
export async function updateSupplierAction(input: z.input<typeof supplierUpdateSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.receive");
  try {
    const data = supplierUpdateSchema.parse(input);
    await withTx((tx) => updateSupplier(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Purchase orders, receiving and supplier payments ──

const lineCost = z.object({ productId: id, qty: z.number().int(), unitCost: text(20) });
const poSchema = z.object({ supplierId: id, remarks: optional(300), lines: z.array(lineCost).min(1).max(100) });
/** Store clerk: a purchase order (DRAFT, for the manager's approval). */
export async function createPoAction(input: z.input<typeof poSchema>): Promise<ActionResult<{ id: string; poNo: string }>> {
  const actor = await requirePermission("store.receive");
  try {
    const data = poSchema.parse(input);
    return ok(await withTx((tx) => createPo(tx, { ...data, lines: data.lines.map((l, i) => ({ ...l, unitCost: pesos(l.unitCost, `unit cost on line ${i + 1}`) })) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const poIdSchema = z.object({ poId: id });
/** Manager (not the preparer): approves a purchase order. */
export async function approvePoAction(input: z.input<typeof poIdSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.po_approve");
  try {
    const data = poIdSchema.parse(input);
    await withTx((tx) => approvePo(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelPoSchema = z.object({ poId: id, reason: text(300) });
/** Manager: cancels a purchase order not yet fully received. */
export async function cancelPoAction(input: z.input<typeof cancelPoSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.po_approve");
  try {
    const data = cancelPoSchema.parse(input);
    await withTx((tx) => cancelPo(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const rrSchema = z.object({
  supplierId: id,
  poId: id.nullable(),
  invoiceNo: optional(60),
  payment: z.enum(RR_PAYMENTS),
  lines: z.array(lineCost.extend({ poLineId: id.nullable() })).min(1).max(100),
});
/** Store clerk: receives a delivery into stock (posted at once). */
export async function receiveAction(input: z.input<typeof rrSchema>): Promise<ActionResult<{ id: string; rrNo: string; jeId: string; dvNo: string | null }>> {
  const actor = await requirePermission("store.receive");
  try {
    const data = rrSchema.parse(input);
    return ok(await withTx((tx) => receive(tx, { ...data, lines: data.lines.map((l, i) => ({ ...l, unitCost: pesos(l.unitCost, `unit cost on line ${i + 1}`) })) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const paySchema = z.object({ supplierId: id, amount: text(20), mode: z.enum(["CASH", "CHECK"]), checkNo: optional(40), particulars: optional(200) });
/** Bookkeeper: prepares a supplier payment voucher (approved by the manager, released by a teller). */
export async function paySupplierAction(input: z.input<typeof paySchema>): Promise<ActionResult<{ dvId: string; dvNo: string }>> {
  const actor = await requirePermission("cash.dv_prepare");
  try {
    const data = paySchema.parse(input);
    return ok(await withTx((tx) => paySupplier(tx, { ...data, amount: pesos(data.amount) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Stock counts ──

const countSchema = z.object({ productIds: z.array(id).max(5000), categoryId: id.nullable().optional(), remarks: optional(300) });
/** Store clerk: a count sheet (all active products when none are chosen). */
export async function createCountAction(input: z.input<typeof countSchema>): Promise<ActionResult<{ id: string; countNo: string }>> {
  const actor = await requirePermission("store.adjust");
  try {
    const data = countSchema.parse(input);
    return ok(await withTx((tx) => createCount(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const enterSchema = z.object({ countId: id, lines: z.array(z.object({ productId: id, countedQty: z.number().int().nullable() })).max(5000) });
/** Store clerk: the counted quantities on a draft sheet. */
export async function enterCountAction(input: z.input<typeof enterSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.adjust");
  try {
    const data = enterSchema.parse(input);
    await withTx((tx) => enterCounts(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const countIdSchema = z.object({ countId: id });
/** Store clerk: submits the counted sheet for the manager's approval. */
export async function submitCountAction(input: z.input<typeof countIdSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("store.adjust");
  try {
    const data = countIdSchema.parse(input);
    await withTx((tx) => submitCount(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Manager (not the preparer): approves a count; its variances are posted. */
export async function approveCountAction(input: z.input<typeof countIdSchema>): Promise<ActionResult<{ jeId: string | null }>> {
  const actor = await requirePermission("store.approve_adjust");
  try {
    const data = countIdSchema.parse(input);
    const r = await withTx((tx) => approveCount(tx, data, actor.id));
    return ok({ jeId: r.jeId });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
