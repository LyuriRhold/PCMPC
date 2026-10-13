"use server";

import "@/modules/plugins";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { format, parse as parseMoney } from "@/lib/money";
import { normalizeName } from "@/lib/names";
import { AuthError, verifySupervisor } from "@/modules/auth/service";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { closeShift, completeSale, openShift, returnSale, verifyShift, voidSale } from "./pos";
import { products, REFUND_MODES, SALE_PAYMENTS, stockBalances } from "./schema";
import { StockError, StoreError } from "./service";

const EXPECTED = [StoreError, StockError, LedgerError, CashieringError, AuthError];

function pesos(text: string, what = "amount"): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new StoreError(`Enter the ${what} in pesos, e.g. 500.00`);
  }
}

const id = z.uuid();
const lineSchema = z.object({ productId: id, qty: z.number().int() });

const shiftSchema = z.object({ openingFund: z.string().trim().max(20) });
/** Cashier: opens today's POS shift with the opening (change) fund. */
export async function openShiftAction(input: z.input<typeof shiftSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("store.pos");
  try {
    const data = shiftSchema.parse(input);
    return ok(await withTx((tx) => openShift(tx, { openingFund: pesos(data.openingFund, "opening fund") }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const saleSchema = z.object({
  memberId: id.nullable(),
  payment: z.enum(SALE_PAYMENTS),
  lines: z.array(lineSchema).min(1).max(200),
  tendered: z.string().trim().max(20).nullable(),
  birInvoiceNo: z.string().trim().max(40).nullable(),
});
/** Cashier: completes a cash or member-charge sale (prices from the item master). */
export async function completeSaleAction(input: z.input<typeof saleSchema>): Promise<ActionResult<{ id: string; saleNo: string; jeId: string; total: string; change: string | null }>> {
  const actor = await requirePermission("store.pos");
  try {
    const data = saleSchema.parse(input);
    const tendered = data.payment === "CASH" && data.tendered ? pesos(data.tendered, "amount tendered") : null;
    const r = await withTx((tx) => completeSale(tx, { ...data, tendered }, actor.id));
    return ok({ id: r.id, saleNo: r.saleNo, jeId: r.jeId, total: format(r.total), change: r.change === null ? null : format(r.change) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const voidSchema = z.object({
  memberId: id.nullable(),
  payment: z.enum(SALE_PAYMENTS).optional(),
  lines: z.array(lineSchema).min(1).max(200),
  reason: z.string().trim().max(300),
  supervisor: z.object({ username: z.string().trim().max(60), password: z.string().max(200) }).nullable(),
});
/** Cashier, with a supervisor's username and password: voids a sale before it is completed. */
export async function voidSaleAction(input: z.input<typeof voidSchema>): Promise<ActionResult<{ id: string; saleNo: string }>> {
  const actor = await requirePermission("store.pos");
  try {
    const data = voidSchema.parse(input);
    if (!data.supervisor || !data.supervisor.username || !data.supervisor.password) throw new StoreError("A supervisor's username and password are needed to void a sale");
    const sup = await verifySupervisor(data.supervisor, "store.supervise");
    return ok(await withTx((tx) => voidSale(tx, { memberId: data.memberId, payment: data.payment ?? "CASH", lines: data.lines, reason: data.reason }, actor.id, sup.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

export type ScannedProduct = { id: string; sku: string; name: string; unit: string; price: string; onHand: number };

const codeSchema = z.object({ code: z.string().trim().min(1).max(60) });
/** Cashier: a product by barcode or SKU (what the scanner or the keyboard enters). */
export async function findProductAction(input: z.input<typeof codeSchema>): Promise<ActionResult<ScannedProduct>> {
  await requirePermission("store.pos");
  try {
    const { code } = codeSchema.parse(input);
    const [p] = await getDb()
      .select({ product: products, onHand: stockBalances.qty })
      .from(products)
      .innerJoin(stockBalances, eq(stockBalances.productId, products.id))
      .where(and(eq(products.isActive, true), or(eq(products.barcode, code), eq(products.sku, code.toUpperCase()))));
    if (!p) throw new StoreError(`No product with barcode or SKU "${code}"`);
    return ok({ id: p.product.id, sku: p.product.sku, name: p.product.name, unit: p.product.unit, price: String(p.product.sellingPrice), onHand: p.onHand });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

export type PosMember = { id: string; memberNo: string; name: string };

const memberSchema = z.object({ q: z.string().trim().min(1).max(60) });
/** Cashier: ACTIVE members by member no. or name (for patronage and charge sales). */
export async function findMembersAction(input: z.input<typeof memberSchema>): Promise<ActionResult<PosMember[]>> {
  await requirePermission("store.pos");
  try {
    const { q } = memberSchema.parse(input);
    const tokens = normalizeName(q).split(" ").filter(Boolean);
    const rows = await getDb()
      .select({ id: members.id, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName })
      .from(members)
      .where(and(eq(members.status, "ACTIVE"), or(eq(members.memberNo, q.toUpperCase()), and(...tokens.map((t) => sql`${members.searchText} LIKE ${`%${t}%`}`)))))
      .orderBy(members.lastName, members.firstName)
      .limit(10);
    return ok(rows.filter((r) => r.memberNo).map((r) => ({ id: r.id, memberNo: r.memberNo as string, name: `${r.lastName}, ${r.firstName}` })));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const returnSchema = z.object({ saleId: id, lines: z.array(z.object({ saleLineId: id, qty: z.number().int() })).min(1).max(200), refundMode: z.enum(REFUND_MODES), reason: z.string().trim().max(300) });
/** Cashier: goods returned from a completed sale; a cash refund comes out of the cashier's drawer. */
export async function returnSaleAction(input: z.input<typeof returnSchema>): Promise<ActionResult<{ id: string; returnNo: string; jeId: string }>> {
  const actor = await requirePermission("store.pos");
  try {
    const data = returnSchema.parse(input);
    const r = await withTx((tx) => returnSale(tx, data, actor.id));
    return ok({ id: r.id, returnNo: r.returnNo, jeId: r.jeId });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const closeSchema = z.object({ shiftId: id, countedCash: z.string().trim().max(20) });
/** Cashier: closes the shift with the cash counted (the Z-reading is kept). */
export async function closeShiftAction(input: z.input<typeof closeSchema>): Promise<ActionResult<{ expectedCash: string; variance: string }>> {
  const actor = await requirePermission("store.pos");
  try {
    const data = closeSchema.parse(input);
    const r = await withTx((tx) => closeShift(tx, { shiftId: data.shiftId, countedCash: pesos(data.countedCash, "cash counted") }, actor.id));
    return ok({ expectedCash: format(r.expectedCash), variance: format(r.variance) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const shiftIdSchema = z.object({ shiftId: id });
/** Manager (not the cashier): verifies a closed shift; a variance is posted to Cash Short/Over. */
export async function verifyShiftAction(input: z.input<typeof shiftIdSchema>): Promise<ActionResult<{ varianceJeId: string | null }>> {
  const actor = await requirePermission("cash.verify");
  try {
    const data = shiftIdSchema.parse(input);
    return ok(await withTx((tx) => verifyShift(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
