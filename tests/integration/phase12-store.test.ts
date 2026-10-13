import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { postJournal, supplierLedger } from "@/modules/ledger/service";
import { productPriceHistory, products, suppliers } from "@/modules/store/schema";
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
