import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { accounts, journalEntries } from "@/modules/ledger/schema";

/**
 * Data migration (PHASE-17): each uploaded Excel file is a batch. A batch is dry-run (validated
 * without touching live tables), staged into its `stg_*` table, reconciled against the cut-off
 * trial balance, then posted (one opening entry + the module records) or rolled back.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** What each template holds, in the order they are imported (members first: the others refer to them). */
export const MIGRATION_ENTITIES = [
  "members",
  "share_capital",
  "savings",
  "time_deposits",
  "loans",
  "water_accounts",
  "water_bills",
  "store_stock",
  "suppliers",
  "store_ar",
  "trial_balance",
] as const;
export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

export const BATCH_STATUSES = ["UPLOADED", "VALIDATED", "STAGED", "POSTED", "ROLLED_BACK"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entity: text("entity").$type<MigrationEntity>().notNull(),
    fileName: text("file_name").notNull(),
    /** SHA-256 of the file: the same file can't be imported twice. */
    fileHash: text("file_hash").notNull(),
    /** The uploaded file as received (re-read when staged; kept as the record of what was imported). */
    content: bytea("content").notNull(),
    cutoffDate: date("cutoff_date", { mode: "string" }).notNull(),
    status: text("status").$type<BatchStatus>().notNull().default("UPLOADED"),
    rowCount: integer("row_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    stagedAt: tstz("staged_at"),
    postedAt: tstz("posted_at"),
    /** The opening entry the batch was posted with. */
    jeId: uuid("je_id").references(() => journalEntries.id),
    rolledBackAt: tstz("rolled_back_at"),
    rolledBackBy: uuid("rolled_back_by").references(() => users.id),
    ...createdColumns(),
  },
  (t) => [
    check("import_batches_entity_chk", inList("entity", MIGRATION_ENTITIES)),
    check("import_batches_status_chk", inList("status", BATCH_STATUSES)),
    check("import_batches_counts_chk", sql`${t.rowCount} >= 0 AND ${t.errorCount} >= 0`),
    check("import_batches_posted_chk", sql`(${t.status} = 'POSTED') = (${t.jeId} IS NOT NULL)`),
    // The same file once (unless its batch was rolled back), and one open batch per kind of record.
    uniqueIndex("import_batches_hash_uq").on(t.fileHash).where(sql`status <> 'ROLLED_BACK'`),
    uniqueIndex("import_batches_open_entity_uq").on(t.entity).where(sql`status IN ('UPLOADED', 'VALIDATED', 'STAGED')`),
    index("import_batches_cutoff_idx").on(t.cutoffDate),
  ],
);

export type ImportBatch = typeof importBatches.$inferSelect;

/** The dry-run report: one row per problem (row 1 is the header row). */
export const importErrors = pgTable(
  "import_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id),
    row: integer("row").notNull(),
    column: text("column").notNull(),
    message: text("message").notNull(),
    ...createdColumns(),
  },
  (t) => [index("import_errors_batch_idx").on(t.batchId, t.row)],
);

const staging = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => importBatches.id),
  /** The row in the uploaded sheet. */
  rowNo: integer("row_no").notNull(),
});

export const stgMembers = pgTable(
  "stg_members",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    suffix: text("suffix"),
    birthdate: date("birthdate", { mode: "string" }).notNull(),
    sex: text("sex").notNull(),
    civilStatus: text("civil_status").notNull(),
    addrStreet: text("addr_street"),
    addrPurok: text("addr_purok"),
    addrBarangay: text("addr_barangay").notNull(),
    addrMunicipality: text("addr_municipality").notNull(),
    addrProvince: text("addr_province").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    occupation: text("occupation"),
    tin: text("tin"),
    membershipDate: date("membership_date", { mode: "string" }).notNull(),
    pmesDate: date("pmes_date", { mode: "string" }),
    bodResolutionNo: text("bod_resolution_no"),
    /** The membership fee paid (0 = not paid). */
    membershipFee: money("membership_fee").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_members_batch_idx").on(t.batchId)],
);

export const stgShareCapital = pgTable(
  "stg_share_capital",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    subscribed: money("subscribed").notNull(),
    paidUp: money("paid_up").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_share_capital_batch_idx").on(t.batchId)],
);

export const stgSavings = pgTable(
  "stg_savings",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    accountNo: text("account_no"),
    productCode: text("product_code").notNull(),
    openedOn: date("opened_on", { mode: "string" }).notNull(),
    balance: money("balance").notNull(),
    lastTxnDate: date("last_txn_date", { mode: "string" }),
    ...createdColumns(),
  },
  (t) => [index("stg_savings_batch_idx").on(t.batchId)],
);

export const stgTimeDeposits = pgTable(
  "stg_time_deposits",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    certificateNo: text("certificate_no"),
    principal: money("principal").notNull(),
    /** Per year, as a decimal ("0.03"). */
    ratePa: text("rate_pa").notNull(),
    termDays: integer("term_days").notNull(),
    placementDate: date("placement_date", { mode: "string" }).notNull(),
    maturityDate: date("maturity_date", { mode: "string" }).notNull(),
    savingsAccountNo: text("savings_account_no"),
    ...createdColumns(),
  },
  (t) => [index("stg_time_deposits_batch_idx").on(t.batchId)],
);

export const stgLoans = pgTable(
  "stg_loans",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    loanNo: text("loan_no"),
    productCode: text("product_code").notNull(),
    principal: money("principal").notNull(),
    term: integer("term").notNull(),
    /** Per month, as a decimal ("0.015"). */
    ratePm: text("rate_pm").notNull(),
    releaseDate: date("release_date", { mode: "string" }).notNull(),
    firstDueDate: date("first_due_date", { mode: "string" }).notNull(),
    installmentsPaid: integer("installments_paid").notNull(),
    outstandingPrincipal: money("outstanding_principal").notNull(),
    unpaidPenalty: money("unpaid_penalty").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_loans_batch_idx").on(t.batchId)],
);

export const stgWaterAccounts = pgTable(
  "stg_water_accounts",
  {
    ...staging(),
    accountNo: text("account_no").notNull(),
    customerNo: text("customer_no"),
    memberNo: text("member_no"),
    lastName: text("last_name"),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    businessName: text("business_name"),
    customerAddress: text("customer_address").notNull(),
    mobile: text("mobile"),
    classification: text("classification").notNull(),
    zoneCode: text("zone_code").notNull(),
    routeCode: text("route_code").notNull(),
    sequenceNo: integer("sequence_no"),
    serviceAddress: text("service_address").notNull(),
    status: text("status").notNull(),
    connectedOn: date("connected_on", { mode: "string" }).notNull(),
    meterSerial: text("meter_serial").notNull(),
    meterDigits: integer("meter_digits").notNull(),
    lastReading: integer("last_reading").notNull(),
    /** m³ billed 1, 2 and 3 months before the cut-off (for the high-consumption check). */
    consumption1: integer("consumption_1"),
    consumption2: integer("consumption_2"),
    consumption3: integer("consumption_3"),
    deposit: money("deposit").notNull(),
    advance: money("advance").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_water_accounts_batch_idx").on(t.batchId)],
);

export const stgWaterBills = pgTable(
  "stg_water_bills",
  {
    ...staging(),
    accountNo: text("account_no").notNull(),
    billNo: text("bill_no"),
    period: text("period").notNull(),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    consumption: integer("consumption"),
    amount: money("amount").notNull(),
    penaltyAssessed: boolean("penalty_assessed").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_water_bills_batch_idx").on(t.batchId)],
);

export const stgStoreStock = pgTable(
  "stg_store_stock",
  {
    ...staging(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    category: text("category"),
    sellingPrice: money("selling_price").notNull(),
    /** Pesos with up to 4 decimals, as in the stock cards. */
    unitCost: text("unit_cost").notNull(),
    quantity: integer("quantity").notNull(),
    reorderLevel: integer("reorder_level").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_store_stock_batch_idx").on(t.batchId)],
);

export const stgSuppliers = pgTable(
  "stg_suppliers",
  {
    ...staging(),
    name: text("name").notNull(),
    contact: text("contact"),
    tin: text("tin"),
    termsDays: integer("terms_days").notNull(),
    balance: money("balance").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_suppliers_batch_idx").on(t.batchId)],
);

export const stgStoreAr = pgTable(
  "stg_store_ar",
  {
    ...staging(),
    memberNo: text("member_no").notNull(),
    balance: money("balance").notNull(),
    chargeLimit: money("charge_limit"),
    ...createdColumns(),
  },
  (t) => [index("stg_store_ar_batch_idx").on(t.batchId)],
);

export const stgTrialBalance = pgTable(
  "stg_trial_balance",
  {
    ...staging(),
    accountCode: text("account_code").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    debit: money("debit").notNull(),
    credit: money("credit").notNull(),
    ...createdColumns(),
  },
  (t) => [index("stg_trial_balance_batch_idx").on(t.batchId), check("stg_trial_balance_side_chk", sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0)`)],
);

/** The staging table of each kind of record. */
export const STAGING = {
  members: stgMembers,
  share_capital: stgShareCapital,
  savings: stgSavings,
  time_deposits: stgTimeDeposits,
  loans: stgLoans,
  water_accounts: stgWaterAccounts,
  water_bills: stgWaterBills,
  store_stock: stgStoreStock,
  suppliers: stgSuppliers,
  store_ar: stgStoreAr,
  trial_balance: stgTrialBalance,
} as const;
