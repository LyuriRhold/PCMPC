import { runAs } from "@/lib/auth-guard";
import { createProductAction, createSupplierAction, receiveAction } from "@/modules/store/actions";
import { makeUser } from "./phase01";
import { setupCashiering } from "./phase04";

const users = { manager: "", clerk: "", book: "", teller: "" };

/**
 * Reference data, FY 2026, today 2026-10-07 (phase04 clock) and the store people: the manager
 * (prices, PO and count approvals), a store clerk (suppliers, POs, receiving, counts), a
 * bookkeeper (supplier payment DVs) and a teller (DV release).
 */
export async function setupStore() {
  const base = await setupCashiering();
  users.manager = base.manager.id;
  users.book = base.book.id;
  users.teller = base.teller.id;
  users.clerk = (await makeUser("STORE_CLERK", "clerk1")).id;
  return { ...users };
}

export const storePeople = () => users;

let seq = 0;

/** A supplier (the store clerk keeps the supplier list); returns its id. */
export async function supplier(name = "S1 Trading", termsDays = 30): Promise<string> {
  const r = await runAs(users.clerk, () => createSupplierAction({ name, contact: "0917 000 0000", tin: null, termsDays }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** A product (the manager sets prices); returns its id. */
export async function product(opts: { sku?: string; name?: string; price?: string; reorderLevel?: number } = {}): Promise<string> {
  seq += 1;
  const r = await runAs(users.manager, () =>
    createProductAction({
      sku: opts.sku ?? `SKU-${seq}`,
      barcode: null,
      name: opts.name ?? `Product ${seq}`,
      unit: "pc",
      categoryId: null,
      sellingPrice: opts.price ?? "70.00",
      reorderLevel: opts.reorderLevel ?? 5,
      vatClass: "VAT_EXEMPT",
    }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** A receiving report by the store clerk, without a PO: lines are [productId, qty, unit cost in pesos]. */
export async function receive(supplierId: string, lines: Array<[string, number, string]>, payment: "ON_ACCOUNT" | "CASH" = "ON_ACCOUNT") {
  const r = await runAs(users.clerk, () =>
    receiveAction({ supplierId, poId: null, invoiceNo: `INV-${Math.random().toString(36).slice(2, 8)}`, payment, lines: lines.map(([productId, qty, unitCost]) => ({ productId, poLineId: null, qty, unitCost })) }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
