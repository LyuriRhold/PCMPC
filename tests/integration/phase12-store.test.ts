import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { postJournal, supplierLedger } from "@/modules/ledger/service";
import { changePriceAction, createCategoryAction, createProductAction, createSupplierAction, updateCategoryAction, updateProductAction, updateSupplierAction } from "@/modules/store/actions";
import { productPriceHistory, products, suppliers } from "@/modules/store/schema";
import { getProduct, listProducts, stockBalance } from "@/modules/store/service";
import { makeUser } from "../helpers/phase01";
import { acct, P } from "../helpers/phase03";
import { setupCashiering } from "../helpers/phase04";

let manager = "";

beforeEach(async () => {
  manager = (await setupCashiering()).manager.id;
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
