"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { parse as parseMoney } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { VAT_CLASSES } from "./schema";
import { changePrice, createCategory, createProduct, createSupplier, StockError, StoreError, updateCategory, updateProduct, updateSupplier } from "./service";

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
