import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { approveDvAction, createDvAction, releaseDvAction } from "@/modules/cashiering/actions";
import { cashOuts, disbursementVouchers } from "@/modules/cashiering/schema";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, supplierLedger, trialBalance } from "@/modules/ledger/service";
import {
  approveCountAction,
  approvePoAction,
  cancelPoAction,
  changePriceAction,
  createCategoryAction,
  createCountAction,
  createPoAction,
  createProductAction,
  createSupplierAction,
  enterCountAction,
  paySupplierAction,
  receiveAction,
  submitCountAction,
  updateCategoryAction,
  updateProductAction,
  updateSupplierAction,
} from "@/modules/store/actions";
import { approvePo, getPo, getRr } from "@/modules/store/purchasing";
import { productPriceHistory, products, purchaseOrders, receivingReports, stockMoves, suppliers } from "@/modules/store/schema";
import { approveCount, getCount, getProduct, listProducts, pendingSupplierPayments, stockBalance, supplierBalance } from "@/modules/store/service";
import { makeUser } from "../helpers/phase01";
import { acct, P } from "../helpers/phase03";
import { openSessionAs } from "../helpers/phase04";
import { product, receive, setupStore, storePeople, supplier } from "../helpers/phase12";

let manager = "";

beforeEach(async () => {
  manager = (await setupStore()).manager;
});
afterEach(() => setClock(null));

describe("T12.1 schema and data rules", () => {
  it("AP–Trade is a supplier sub-ledger: each line carries a known supplier", async () => {
    const [s] = await getDb().insert(suppliers).values({ name: "Acme Trading", termsDays: 30 }).returning();
    const [inv, ap] = [await acct("merchandise_inventory"), await acct("accounts_payable_trade")];
    const entry = (supplierId: string | null) => withTx((tx) => postJournal(tx, { date: "2026-10-07", book: "PJ", particulars: "Delivery", lines: [{ accountId: inv, debit: P(100) }, { accountId: ap, credit: P(100), supplierId }] }, null));
    await expect(entry(null)).rejects.toThrow(/supplier subsidiary ledger; choose the supplier/);
    await expect(entry(randomUUID())).rejects.toThrow(/unknown supplier/);
    await entry(s!.id);
    expect((await supplierLedger("accounts_payable_trade", s!.id, "2026-01-01", "2026-12-31")).closing).toBe(P(100));
  });

  it("products, suppliers and categories are deactivated, never deleted; price history is never changed", async () => {
    const clerk = await makeUser("STORE_CLERK", "clerk_dr");
    const [s] = await getDb().insert(suppliers).values({ name: "Beta Supply", createdBy: clerk.id }).returning();
    const [p] = await getDb().insert(products).values({ sku: "DR-1", name: "Sardines", unit: "can", sellingPrice: P(25) }).returning();
    await getDb().insert(productPriceHistory).values({ productId: p!.id, price: P(25), by: manager });
    const pool = getPool();
    await expect(pool.query("DELETE FROM products WHERE id = $1", [p!.id])).rejects.toThrow(/can't be deleted/);
    await expect(pool.query("DELETE FROM suppliers WHERE id = $1", [s!.id])).rejects.toThrow(/can't be deleted/);
    await expect(pool.query("UPDATE product_price_history SET price = 1 WHERE product_id = $1", [p!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO stock_balances (product_id, qty, avg_cost, value) VALUES ($1, -1, 0, 0)", [p!.id])).rejects.toThrow(/stock_balances_chk/);
    await expect(pool.query("INSERT INTO stock_balances (product_id, qty, avg_cost, value) VALUES ($1, 0, 0, 100)", [p!.id])).rejects.toThrow(/stock_balances_chk/);
    await getDb().update(products).set({ isActive: false }).where(eq(products.id, p!.id));
  });
});

describe("T12.3 products, categories, prices and suppliers", () => {
  const newProduct = (o: Partial<Parameters<typeof createProductAction>[0]> = {}) =>
    createProductAction({ sku: "rice-25", barcode: null, name: "Rice 25 kg", unit: "sack", categoryId: null, sellingPrice: "1,350.00", reorderLevel: 5, vatClass: "VAT_EXEMPT", ...o });

  it("the manager keeps the item master; a new product starts with no stock and its first price", async () => {
    const clerk = (await makeUser("STORE_CLERK", "clerk_t3")).id;
    await expect(runAs(clerk, () => newProduct())).rejects.toBeInstanceOf(ForbiddenError);
    const cat = await runAs(manager, () => createCategoryAction({ name: "Grains" }));
    if (!cat.ok) throw new Error(cat.error);
    expect(await runAs(manager, () => createCategoryAction({ name: "grains" }))).toMatchObject({ ok: false, error: 'Category "grains" already exists' });
    const p = await runAs(manager, () => newProduct({ categoryId: cat.data.id, barcode: "4800016123456" }));
    if (!p.ok) throw new Error(p.error);
    const data = (await getProduct(p.data.id))!;
    expect(data.product).toMatchObject({ sku: "RICE-25", sellingPrice: P(1350), reorderLevel: 5, isActive: true });
    expect(data.category).toBe("Grains");
    expect(data.prices.map((h) => h.price)).toEqual([P(1350)]);
    expect(await stockBalance(p.data.id)).toEqual({ qty: 0, avgCost: "0.0000", value: 0n });
    expect(await runAs(manager, () => newProduct({ name: "Other" }))).toMatchObject({ ok: false, error: "SKU RICE-25 is already used" });
    expect(await runAs(manager, () => newProduct({ sku: "R2", barcode: "4800016123456" }))).toMatchObject({ ok: false, error: "Barcode 4800016123456 is already used" });
    expect(await runAs(manager, () => newProduct({ sku: "R3", sellingPrice: "abc" }))).toMatchObject({ ok: false, error: expect.stringMatching(/selling price in pesos/) });
    expect((await listProducts({ q: "rice" })).map((r) => r.product.sku)).toEqual(["RICE-25"]);
    expect((await listProducts({ q: "4800016123456" })).map((r) => r.product.sku)).toEqual(["RICE-25"]);

    // Turning a category off keeps it on its products; a product is deactivated, not deleted.
    expect((await runAs(manager, () => updateCategoryAction({ id: cat.data.id, name: "Grains", isActive: false }))).ok).toBe(true);
    expect(await runAs(manager, () => newProduct({ sku: "R4", categoryId: cat.data.id }))).toMatchObject({ ok: false, error: "Choose an active category" });
    const upd = await runAs(manager, () =>
      updateProductAction({ id: p.data.id, sku: "RICE-25", barcode: null, name: "Rice 25 kg (well-milled)", unit: "sack", categoryId: cat.data.id, reorderLevel: 3, vatClass: "VAT_EXEMPT", isActive: false }),
    );
    expect(upd.ok).toBe(true);
    expect((await getProduct(p.data.id))!.product).toMatchObject({ name: "Rice 25 kg (well-milled)", barcode: null, reorderLevel: 3, isActive: false, sellingPrice: P(1350) });
  });

  it("a price change needs store.price and is kept in the history", async () => {
    const p = await runAs(manager, () => newProduct());
    if (!p.ok) throw new Error(p.error);
    const clerk = (await makeUser("STORE_CLERK", "clerk_t3b")).id;
    await expect(runAs(clerk, () => changePriceAction({ productId: p.data.id, price: "1,400.00" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(manager, () => changePriceAction({ productId: p.data.id, price: "1,350.00" }))).toMatchObject({ ok: false, error: "Rice 25 kg already sells at ₱1,350.00" });
    expect((await runAs(manager, () => changePriceAction({ productId: p.data.id, price: "1,400.00" }))).ok).toBe(true);
    const data = (await getProduct(p.data.id))!;
    expect(data.product.sellingPrice).toBe(P(1400));
    expect(data.prices.map((h) => [h.price, h.by])).toEqual([
      [P(1400), manager],
      [P(1350), manager],
    ]);
  });

  it("the store clerk keeps the supplier list", async () => {
    const clerk = (await makeUser("STORE_CLERK", "clerk_t3c")).id;
    await expect(runAs(manager, () => createSupplierAction({ name: "Acme", contact: null, tin: null, termsDays: 30 }))).rejects.toBeInstanceOf(ForbiddenError);
    const s = await runAs(clerk, () => createSupplierAction({ name: "Acme Trading", contact: "Ana 0917", tin: "123-456-789-000", termsDays: 30 }));
    if (!s.ok) throw new Error(s.error);
    expect(await runAs(clerk, () => createSupplierAction({ name: "ACME TRADING", contact: null, tin: null, termsDays: 0 }))).toMatchObject({ ok: false, error: 'Supplier "ACME TRADING" already exists' });
    expect(await runAs(clerk, () => createSupplierAction({ name: "Beta", contact: null, tin: "12", termsDays: 0 }))).toMatchObject({ ok: false, error: expect.stringMatching(/TIN/) });
    expect(await runAs(clerk, () => createSupplierAction({ name: "Beta", contact: null, tin: null, termsDays: 400 }))).toMatchObject({ ok: false, error: "Terms are 0 to 365 days" });
    expect((await runAs(clerk, () => updateSupplierAction({ id: s.data.id, name: "Acme Trading", contact: null, tin: null, termsDays: 15, isActive: false }))).ok).toBe(true);
    const [row] = await getDb().select().from(suppliers).where(eq(suppliers.id, s.data.id));
    expect(row).toMatchObject({ termsDays: 15, isActive: false, contact: null });
  });
});

describe("T12.4 purchase orders, receiving, payables and supplier payments", () => {
  async function draftPo(s: string, lines: Array<[string, number, string]>) {
    const { clerk } = storePeople();
    const po = await runAs(clerk, () => createPoAction({ supplierId: s, remarks: null, lines: lines.map(([productId, qty, unitCost]) => ({ productId, qty, unitCost })) }));
    if (!po.ok) throw new Error(po.error);
    return po.data;
  }

  it("the clerk prepares a PO, the manager (not the preparer) approves it; deliveries are received against it in parts", async () => {
    const { clerk } = storePeople();
    const s1 = await supplier("S1 Trading", 30);
    const s2 = await supplier("S2 Supply", 0);
    const [p1, p2] = [await product({ sku: "P1" }), await product({ sku: "P2" })];
    const po = await draftPo(s1, [
      [p1, 10, "50.00"],
      [p2, 4, "10.01"],
    ]);
    expect(po.poNo).toBe("PO-2026-00001");
    const lines = (await getPo(po.id))!.lines;
    const recv = (qtys: [number, number], supplierId = s1) =>
      runAs(clerk, () =>
        receiveAction({
          supplierId,
          poId: po.id,
          invoiceNo: "SI-1",
          payment: "ON_ACCOUNT",
          lines: lines.map((l, i) => ({ productId: l.product.id, poLineId: l.line.id, qty: qtys[i]!, unitCost: i === 0 ? "50.00" : "10.01" })).filter((l) => l.qty > 0),
        }),
      );
    expect(await recv([5, 0])).toMatchObject({ ok: false, error: expect.stringMatching(/isn.t approved yet/) });
    await expect(runAs(clerk, () => approvePoAction({ poId: po.id }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTx((tx) => approvePo(tx, { poId: po.id }, clerk))).rejects.toThrow(/preparer cannot approve/);
    expect((await runAs(manager, () => approvePoAction({ poId: po.id }))).ok).toBe(true);
    expect(await recv([5, 0], s2)).toMatchObject({ ok: false, error: expect.stringMatching(/for another supplier/) });

    const first = await recv([6, 0]);
    if (!first.ok) throw new Error(first.error);
    expect((await getPo(po.id))!.po.status).toBe("PARTIAL");
    expect(await recv([5, 4])).toMatchObject({ ok: false, error: expect.stringMatching(/only 4 still to come on PO-2026-00001/) });
    const second = await recv([4, 4]);
    if (!second.ok) throw new Error(second.error);
    const after = (await getPo(po.id))!;
    expect(after.po.status).toBe("RECEIVED");
    expect(after.lines.map((l) => [l.line.qtyReceived, l.remaining])).toEqual([
      [10, 0],
      [4, 0],
    ]);
    expect(await recv([1, 0])).toMatchObject({ ok: false, error: expect.stringMatching(/is RECEIVED/) });
    expect(await runAs(manager, () => cancelPoAction({ poId: po.id, reason: "x" }))).toMatchObject({ ok: false, error: "PO-2026-00001 is RECEIVED" });

    expect(await stockBalance(p1)).toEqual({ qty: 10, avgCost: "50.0000", value: P(500) });
    expect(await stockBalance(p2)).toEqual({ qty: 4, avgCost: "10.0100", value: P(40, 4) });
    // AP S1 = both deliveries; each is due 30 days after it was received.
    expect(await supplierBalance(s1)).toBe(P(540, 4));
    expect((await getRr(second.data.id))!.rr).toMatchObject({ rrNo: "RR-2026-00002", total: P(240, 4), dueDate: "2026-11-06", payment: "ON_ACCOUNT" });
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, second.data.jeId));
    expect(je).toMatchObject({ book: "PJ", sourceModule: "store", reference: "SI-1" });
  });

  it("a PO is cancelled by the manager with a reason", async () => {
    const s1 = await supplier();
    const p1 = await product();
    const po = await draftPo(s1, [[p1, 10, "5.00"]]);
    await expect(runAs(storePeople().clerk, () => cancelPoAction({ poId: po.id, reason: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(manager, () => cancelPoAction({ poId: po.id, reason: " " }))).toMatchObject({ ok: false, error: "Enter why the purchase order is cancelled" });
    expect((await runAs(manager, () => cancelPoAction({ poId: po.id, reason: "Supplier out of stock" }))).ok).toBe(true);
    expect((await getPo(po.id))!.po).toMatchObject({ status: "CANCELLED", cancelReason: "Supplier out of stock" });
  });

  it("receiving without a PO: whole quantities, a total above zero; nothing is posted on an error", async () => {
    const { clerk } = storePeople();
    const s1 = await supplier();
    const p1 = await product();
    const bad = (lines: Array<{ qty: number; unitCost: string }>) =>
      runAs(clerk, () => receiveAction({ supplierId: s1, poId: null, invoiceNo: null, payment: "ON_ACCOUNT", lines: lines.map((l) => ({ productId: p1, poLineId: null, ...l })) }));
    expect(await bad([{ qty: 0, unitCost: "1.00" }])).toMatchObject({ ok: false, error: expect.stringMatching(/whole number more than zero/) });
    expect(await bad([{ qty: 2, unitCost: "0.00" }])).toMatchObject({ ok: false, error: "The delivery's total must be more than zero" });
    expect(await bad([{ qty: 2, unitCost: "x" }])).toMatchObject({ ok: false, error: expect.stringMatching(/unit cost on line 1 in pesos/) });
    expect(await getDb().select().from(receivingReports)).toHaveLength(0);
    expect(await getDb().select().from(stockMoves)).toHaveLength(0);
  });

  it("cash on delivery: the payable is settled by a DV the manager approves and a teller pays from the drawer", async () => {
    const { clerk, teller } = storePeople();
    const s1 = await supplier();
    const p1 = await product();
    const rr = await receive(s1, [[p1, 3, "10.00"]], "CASH");
    expect(rr.dvNo).toBe("DV-2026-00001");
    const { dv } = (await getRr(rr.id))!;
    expect(dv).toMatchObject({ status: "DRAFT" });
    expect(await supplierBalance(s1)).toBe(P(30));
    expect(await pendingSupplierPayments(s1)).toBe(P(30));
    await expect(runAs(clerk, () => approveDvAction({ dvId: dv!.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await runAs(manager, () => approveDvAction({ dvId: dv!.id }))).ok).toBe(true);
    await openSessionAs(teller, "1,000.00");
    const rel = await runAs(teller, () => releaseDvAction({ dvId: dv!.id }));
    if (!rel.ok) throw new Error(rel.error);
    expect(await supplierBalance(s1)).toBe(0n);
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, rel.data.jeId));
    const [ap, cash] = [await accountIdFor("accounts_payable_trade"), await accountIdFor("cash_on_hand")];
    expect(lines.map((l) => [l.accountId, l.debit, l.credit, l.supplierId])).toEqual([
      [ap, P(30), 0n, s1],
      [cash, 0n, P(30), null],
    ]);
    expect((await getDb().select().from(cashOuts).where(eq(cashOuts.refId, dv!.id))).map((c) => c.amount)).toEqual([P(30)]);
  });

  it("supplier payments are prepared by the bookkeeper, up to what is owed less payments already prepared", async () => {
    const { book, teller, clerk } = storePeople();
    const s1 = await supplier();
    const p1 = await product();
    await receive(s1, [[p1, 20, "55.00"]]);
    await expect(runAs(clerk, () => paySupplierAction({ supplierId: s1, amount: "100.00", mode: "CHECK", checkNo: "1001", particulars: null }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(book, () => paySupplierAction({ supplierId: s1, amount: "1,100.01", mode: "CHECK", checkNo: "1001", particulars: null }))).toMatchObject({
      ok: false,
      error: "S1 Trading is owed ₱1,100.00 (after payments already prepared)",
    });
    const pay = await runAs(book, () => paySupplierAction({ supplierId: s1, amount: "600.00", mode: "CHECK", checkNo: "1001", particulars: "Invoice SI-1" }));
    if (!pay.ok) throw new Error(pay.error);
    expect(await runAs(book, () => paySupplierAction({ supplierId: s1, amount: "500.01", mode: "CHECK", checkNo: "1002", particulars: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/owed ₱500\.00/) });
    expect((await runAs(manager, () => approveDvAction({ dvId: pay.data.dvId }))).ok).toBe(true);
    const rel = await runAs(teller, () => releaseDvAction({ dvId: pay.data.dvId }));
    if (!rel.ok) throw new Error(rel.error);
    expect(await supplierBalance(s1)).toBe(P(500));
    const [dv] = await getDb().select().from(disbursementVouchers).where(eq(disbursementVouchers.id, pay.data.dvId));
    expect(dv).toMatchObject({ status: "RELEASED", payee: "S1 Trading", mode: "CHECK" });
    // The test clock is frozen, so both entries post at the same instant: compare without order.
    const ledger = await supplierLedger("accounts_payable_trade", s1, "2026-01-01", "2026-12-31");
    expect(ledger.lines.map((l) => [l.debit, l.credit])).toEqual(expect.arrayContaining([[0n, P(1100)], [P(600), 0n]]));
    expect(ledger.lines).toHaveLength(2);
    expect(ledger.closing).toBe(P(500));
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("a manual DV can't debit AP–Trade without the supplier", async () => {
    const r = await runAs(storePeople().book, () =>
      createDvAction({ date: "2026-10-07", payee: "Someone", particulars: "x", mode: "CHECK", checkNo: "9", lines: [{ accountId: "", mappingKey: "accounts_payable_trade", amount: "10.00", memberNo: "", memo: "" }] }),
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/paid from Store › Payables/) });
  });

  it("receiving reports, their lines and stock moves are never changed; a PO's status moves forward only", async () => {
    const s1 = await supplier();
    const p1 = await product();
    const rr = await receive(s1, [[p1, 2, "5.00"]]);
    const po = await draftPo(s1, [[p1, 1, "5.00"]]);
    const pool = getPool();
    await expect(pool.query("UPDATE receiving_reports SET total = 1 WHERE id = $1", [rr.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM rr_lines WHERE rr_id = $1", [rr.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE stock_moves SET qty = 1 WHERE ref_id = $1", [rr.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = $1", [po.id])).rejects.toThrow(/can.t go from DRAFT to RECEIVED/);
    await expect(pool.query("UPDATE purchase_orders SET total = 1 WHERE id = $1", [po.id])).rejects.toThrow(/only the status, approval and cancellation change/);
    await expect(pool.query("UPDATE po_lines SET qty = 5 WHERE po_id = $1", [po.id])).rejects.toThrow(/only the quantity received grows/);
    const [row] = await getDb().select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
    expect(row?.status).toBe("DRAFT");
  });
});

describe("T12.5 stock counts", () => {
  async function counted(lines: Array<[string, number | null]>, opts: { submit?: boolean } = {}) {
    const { clerk } = storePeople();
    const c = await runAs(clerk, () => createCountAction({ productIds: lines.map(([p]) => p), remarks: null }));
    if (!c.ok) throw new Error(c.error);
    const e = await runAs(clerk, () => enterCountAction({ countId: c.data.id, lines: lines.map(([productId, countedQty]) => ({ productId, countedQty })) }));
    if (!e.ok) throw new Error(e.error);
    if (opts.submit !== false) {
      const s = await runAs(clerk, () => submitCountAction({ countId: c.data.id }));
      if (!s.ok) throw new Error(s.error);
    }
    return c.data;
  }

  it("a sheet of all active products; every product counted before submission; the system quantities are taken on submission", async () => {
    const { clerk } = storePeople();
    const s1 = await supplier();
    const [p1, p2, p3] = [await product({ sku: "C1", name: "C1 item" }), await product({ sku: "C2", name: "C2 item" }), await product({ sku: "C3", name: "C3 item" })];
    await runAs(manager, () => updateProductAction({ id: p3, sku: "C3", barcode: null, name: "Old item", unit: "pc", categoryId: null, reorderLevel: 0, vatClass: "VAT_EXEMPT", isActive: false }));
    await receive(s1, [[p1, 10, "4.00"]]);
    const all = await runAs(clerk, () => createCountAction({ productIds: [], remarks: "Month-end" }));
    if (!all.ok) throw new Error(all.error);
    expect(all.data.countNo).toBe("SC-2026-00001");
    expect((await getCount(all.data.id))!.lines.map((l) => l.sku).sort()).toEqual(["C1", "C2"]);
    expect((await runAs(clerk, () => enterCountAction({ countId: all.data.id, lines: [{ productId: p1, countedQty: 9 }] }))).ok).toBe(true);
    expect(await runAs(clerk, () => enterCountAction({ countId: all.data.id, lines: [{ productId: p3, countedQty: 1 }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't on SC-2026-00001/) });
    expect(await runAs(clerk, () => enterCountAction({ countId: all.data.id, lines: [{ productId: p2, countedQty: -1 }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/whole number, 0 or more/) });
    expect(await runAs(clerk, () => submitCountAction({ countId: all.data.id }))).toMatchObject({ ok: false, error: "Count every product first (1 not counted)" });
    // Stock moves between the count and its submission are in the system quantity.
    await receive(s1, [[p1, 1, "4.00"]]);
    expect((await runAs(clerk, () => enterCountAction({ countId: all.data.id, lines: [{ productId: p2, countedQty: 0 }] }))).ok).toBe(true);
    expect((await runAs(clerk, () => submitCountAction({ countId: all.data.id }))).ok).toBe(true);
    const sheet = (await getCount(all.data.id))!;
    expect(sheet.count.status).toBe("SUBMITTED");
    expect(sheet.lines.map((l) => [l.sku, l.systemQty, l.countedQty, l.variance, l.varianceValue])).toEqual([
      ["C1", 11, 9, -2, -P(8)],
      ["C2", 0, 0, 0, 0n],
    ]);
    expect(await runAs(clerk, () => enterCountAction({ countId: all.data.id, lines: [{ productId: p1, countedQty: 11 }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/SUBMITTED; counts are entered on a draft/) });
  });

  it("approval (not by the preparer) posts shortages and overages in one entry, at the moving average", async () => {
    const { clerk } = storePeople();
    const s1 = await supplier();
    const [p1, p2] = [await product({ sku: "A1", name: "A1 item" }), await product({ sku: "A2", name: "A2 item" })];
    await receive(s1, [[p1, 3, "10.00"]]);
    await receive(s1, [[p2, 3, "1.00"]]);
    await receive(s1, [[p2, 4, "1.01"]]);
    // p1: 3 → 0 (all gone: the remaining ₱30.00); p2: 7 @ 1.0057 (₱7.04) → 9 (+2 at the average: ₱2.01; ₱9.05 @ 1.0056).
    const c = await counted([
      [p1, 0],
      [p2, 9],
    ]);
    await expect(withTx((tx) => approveCount(tx, { countId: c.id }, clerk))).rejects.toThrow(/preparer cannot approve/);
    const r = await runAs(manager, () => approveCountAction({ countId: c.id }));
    if (!r.ok) throw new Error(r.error);
    const [losses, inv, gains] = [await accountIdFor("inventory_losses"), await accountIdFor("merchandise_inventory"), await accountIdFor("inventory_gains")];
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, r.data.jeId!));
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [losses, P(30), 0n],
      [inv, 0n, P(30)],
      [inv, P(2, 1), 0n],
      [gains, 0n, P(2, 1)],
    ]);
    expect(await stockBalance(p1)).toEqual({ qty: 0, avgCost: "10.0000", value: 0n });
    expect(await stockBalance(p2)).toEqual({ qty: 9, avgCost: "1.0056", value: P(9, 5) });
    const sheet = (await getCount(c.id))!;
    expect(sheet.count).toMatchObject({ status: "APPROVED", approvedBy: manager, jeId: r.data.jeId });
    expect(sheet.lines.map((l) => [l.sku, l.varianceValue])).toEqual([
      ["A1", -P(30)],
      ["A2", P(2, 1)],
    ]);
    const moves = await getDb().select().from(stockMoves).where(eq(stockMoves.refId, c.id));
    expect(moves.map((m) => [m.type, m.qty, m.totalCost, m.qtyAfter, m.valueAfter]).sort()).toEqual(
      [
        ["ADJUST", -3, -P(30), 0, 0n],
        ["ADJUST", 2, P(2, 1), 9, P(9, 5)],
      ].sort(),
    );
    expect(await runAs(manager, () => approveCountAction({ countId: c.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/already APPROVED/) });
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);

    const pool = getPool();
    await expect(pool.query("UPDATE stock_counts SET remarks = 'x' WHERE id = $1", [c.id])).rejects.toThrow(/approved stock count can't change/);
    await expect(pool.query("UPDATE stock_count_lines SET counted_qty = 5 WHERE count_id = $1", [c.id])).rejects.toThrow(/approved stock count can't change/);
  });

  it("a count with no variance, or only variances of no value, is approved without an entry", async () => {
    const s1 = await supplier();
    const [p1, p2] = [await product({ sku: "Z1" }), await product({ sku: "Z2" })];
    await receive(s1, [[p1, 5, "2.00"]]);
    // p2 was never received (average 0): an overage of 2 has no value.
    const c = await counted([
      [p1, 5],
      [p2, 2],
    ]);
    const r = await runAs(manager, () => approveCountAction({ countId: c.id }));
    expect(r).toEqual({ ok: true, data: { jeId: null } });
    expect(await stockBalance(p2)).toEqual({ qty: 2, avgCost: "0.0000", value: 0n });
    const [move] = await getDb().select().from(stockMoves).where(eq(stockMoves.refId, c.id));
    expect(move).toMatchObject({ qty: 2, totalCost: 0n, jeId: null });
  });

  it("only the store clerk counts; a draft isn't approved", async () => {
    const s1 = await supplier();
    const p1 = await product();
    await receive(s1, [[p1, 1, "2.00"]]);
    await expect(runAs(manager, () => createCountAction({ productIds: [p1], remarks: null }))).rejects.toBeInstanceOf(ForbiddenError);
    const c = await counted([[p1, 1]], { submit: false });
    expect(await runAs(manager, () => approveCountAction({ countId: c.id }))).toMatchObject({ ok: false, error: "SC-2026-00001 isn't submitted yet" });
  });
});
