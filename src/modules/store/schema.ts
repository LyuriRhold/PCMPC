import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { disbursementVouchers } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";

/**
 * The consumer store's inventory and purchasing (PHASE-12): the item master and its price history,
 * suppliers, purchase orders, receiving reports, the moving-average stock ledger (moves and one
 * balance per product), stock counts, and supplier payables (journal lines tagged with the supplier).
 * Quantities are whole units of the product's unit (CONFIRM Q-12.1); amounts are centavos; the
 * moving-average unit cost is pesos with 4 decimals (DOMAIN §3).
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });
/** A unit cost in pesos, 4 decimals (moving average). */
const unitCost4 = (name: string) => numeric(name, { precision: 14, scale: 4 });

export const VAT_CLASSES = ["VAT", "VAT_EXEMPT", "ZERO_RATED"] as const;
export type VatClass = (typeof VAT_CLASSES)[number];

export const productCategories = pgTable("product_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  ...createdColumns(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(),
    barcode: text("barcode").unique(),
    name: text("name").notNull(),
    /** The unit stock is counted in (pc, pack, sack, kg). */
    unit: text("unit").notNull(),
    categoryId: uuid("category_id").references(() => productCategories.id),
    /** Centavos; changed only with store.price, each change kept in product_price_history. */
    sellingPrice: money("selling_price").notNull(),
    reorderLevel: integer("reorder_level").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /** CONFIRM Q-12.3: kept for the BIR set-up; not used in the postings yet. */
    vatClass: text("vat_class").$type<VatClass>().notNull().default("VAT_EXEMPT"),
    ...createdColumns(),
  },
  (t) => [
    check("products_price_chk", sql`${t.sellingPrice} >= 0 AND ${t.reorderLevel} >= 0`),
    check("products_vat_class_chk", inList("vat_class", VAT_CLASSES)),
    index("products_category_idx").on(t.categoryId),
  ],
);

/** Every selling price a product had (the first one when it was created). */
export const productPriceHistory = pgTable(
  "product_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    price: money("price").notNull(),
    effectiveAt: tstz("effective_at").notNull().defaultNow(),
    by: uuid("by")
      .notNull()
      .references(() => users.id),
    ...createdColumns(),
  },
  (t) => [check("product_price_history_price_chk", sql`${t.price} >= 0`), index("product_price_history_product_idx").on(t.productId, t.effectiveAt)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    contact: text("contact"),
    tin: text("tin"),
    /** Days of credit: a delivery on account is due this many days after it is received. */
    termsDays: integer("terms_days").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...createdColumns(),
  },
  (t) => [check("suppliers_terms_chk", sql`${t.termsDays} >= 0`)],
);

export const PO_STATUSES = ["DRAFT", "APPROVED", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** A purchase order: prepared by the store clerk, approved by the manager, then received (in part or in full). */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poNo: text("po_no").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    poDate: date("po_date", { mode: "string" }).notNull(),
    status: text("status").$type<PoStatus>().notNull().default("DRAFT"),
    remarks: text("remarks"),
    total: money("total").notNull(),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    cancelReason: text("cancel_reason"),
    ...createdColumns(),
  },
  (t) => [check("purchase_orders_status_chk", inList("status", PO_STATUSES)), check("purchase_orders_total_chk", sql`${t.total} >= 0`), index("purchase_orders_supplier_idx").on(t.supplierId)],
);

export const poLines = pgTable(
  "po_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(),
    /** Centavos per unit. */
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
    ...createdColumns(),
  },
  (t) => [
    unique("po_lines_line_uq").on(t.poId, t.lineNo),
    check("po_lines_amounts_chk", sql`${t.qty} > 0 AND ${t.unitCost} >= 0 AND ${t.lineTotal} = ${t.qty} * ${t.unitCost} AND ${t.qtyReceived} >= 0 AND ${t.qtyReceived} <= ${t.qty}`),
  ],
);

export const RR_PAYMENTS = ["CASH", "ON_ACCOUNT"] as const;
export type RrPayment = (typeof RR_PAYMENTS)[number];

/**
 * A delivery received into stock (posted when saved): Dr Merchandise Inventory / Cr AP–Trade
 * tagged with the supplier. A cash delivery also gets a supplier-payment DV for the teller to pay
 * from the drawer (CONFIRM Q-12.4).
 */
export const receivingReports = pgTable(
  "receiving_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rrNo: text("rr_no").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    rrDate: date("rr_date", { mode: "string" }).notNull(),
    /** The supplier's invoice or delivery receipt no. */
    invoiceNo: text("invoice_no"),
    payment: text("payment").$type<RrPayment>().notNull(),
    total: money("total").notNull(),
    /** When the payable is due (the receiving date plus the supplier's terms). */
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /** CASH: the supplier-payment voucher created with it. */
    dvId: uuid("dv_id").references(() => disbursementVouchers.id),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [check("receiving_reports_payment_chk", inList("payment", RR_PAYMENTS)), check("receiving_reports_total_chk", sql`${t.total} > 0`), index("receiving_reports_supplier_idx").on(t.supplierId, t.rrDate)],
);

export const rrLines = pgTable(
  "rr_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rrId: uuid("rr_id")
      .notNull()
      .references(() => receivingReports.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    poLineId: uuid("po_line_id").references(() => poLines.id),
    qty: integer("qty").notNull(),
    /** Centavos per unit, as invoiced. */
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("rr_lines_line_uq").on(t.rrId, t.lineNo), check("rr_lines_amounts_chk", sql`${t.qty} > 0 AND ${t.unitCost} >= 0 AND ${t.lineTotal} = ${t.qty} * ${t.unitCost}`)],
);

export const MOVE_TYPES = ["RECEIVE", "SALE", "RETURN", "ADJUST"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

/**
 * The stock ledger: one row per movement, with the balance after it (the stock card). `qty` and
 * `total_cost` are signed (+ in, − out); `unit_cost` is the move's cost per unit (the moving average
 * for issues). Never changed or deleted.
 */
export const stockMoves = pgTable(
  "stock_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    moveDate: date("move_date", { mode: "string" }).notNull(),
    type: text("type").$type<MoveType>().notNull(),
    qty: integer("qty").notNull(),
    unitCost: unitCost4("unit_cost").notNull(),
    totalCost: money("total_cost").notNull(),
    qtyAfter: integer("qty_after").notNull(),
    avgCostAfter: unitCost4("avg_cost_after").notNull(),
    valueAfter: money("value_after").notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("stock_moves_type_chk", inList("type", MOVE_TYPES)),
    check("stock_moves_amounts_chk", sql`${t.qty} <> 0 AND ((${t.qty} > 0 AND ${t.totalCost} >= 0) OR (${t.qty} < 0 AND ${t.totalCost} <= 0)) AND ${t.qtyAfter} >= 0 AND ${t.valueAfter} >= 0`),
    index("stock_moves_product_idx").on(t.productId, t.moveDate),
    index("stock_moves_ref_idx").on(t.refType, t.refId),
  ],
);

/** Each product's running stock: never negative (store.allow_negative_stock is fixed to false). */
export const stockBalances = pgTable(
  "stock_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .unique()
      .references(() => products.id),
    qty: integer("qty").notNull().default(0),
    avgCost: unitCost4("avg_cost").notNull().default("0"),
    value: money("value").notNull().default(sql`0`),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    ...createdColumns(),
  },
  (t) => [check("stock_balances_chk", sql`${t.qty} >= 0 AND ${t.value} >= 0 AND (${t.qty} > 0 OR ${t.value} = 0)`)],
);

export const COUNT_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

/** A physical count: prepared by the store clerk, approved by the manager (≠ preparer), whose approval posts the variances. */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countNo: text("count_no").notNull().unique(),
    countDate: date("count_date", { mode: "string" }).notNull(),
    status: text("status").$type<CountStatus>().notNull().default("DRAFT"),
    remarks: text("remarks"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    submittedAt: tstz("submitted_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    /** The adjustment entry (none when nothing differed). */
    jeId: uuid("je_id").references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [check("stock_counts_status_chk", inList("status", COUNT_STATUSES))],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** The system quantity when the count was submitted. */
    systemQty: integer("system_qty"),
    countedQty: integer("counted_qty"),
    /** counted − system, set on submission. */
    variance: integer("variance"),
    /** The value posted on approval (− shortage, + overage). */
    varianceValue: money("variance_value"),
    ...createdColumns(),
  },
  (t) => [
    unique("stock_count_lines_uq").on(t.countId, t.productId),
    check("stock_count_lines_qty_chk", sql`(${t.countedQty} IS NULL OR ${t.countedQty} >= 0) AND (${t.systemQty} IS NULL OR ${t.systemQty} >= 0) AND (${t.variance} IS NULL OR ${t.variance} = ${t.countedQty} - ${t.systemQty})`),
  ],
);

export type Product = typeof products.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PoLine = typeof poLines.$inferSelect;
export type ReceivingReport = typeof receivingReports.$inferSelect;
export type StockMove = typeof stockMoves.$inferSelect;
export type StockCount = typeof stockCounts.$inferSelect;
export type StockCountLine = typeof stockCountLines.$inferSelect;
