import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { accounts, journalEntries, journalLines } from "@/modules/ledger/schema";

/**
 * Financial statements, period close, fixed assets and bank reconciliation (PHASE-14). The
 * statements are computed from the GL through the statement lines each account is mapped to.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const STATEMENTS = ["SFC", "SOO"] as const;
export type StatementCode = (typeof STATEMENTS)[number];
export const FS_SECTIONS = ["ASSETS", "LIABILITIES", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type FsSection = (typeof FS_SECTIONS)[number];
export const CASH_FLOW_CLASSES = ["CASH", "OPERATING", "INVESTING", "FINANCING"] as const;
export type CashFlowClass = (typeof CASH_FLOW_CLASSES)[number];

/**
 * A line of the Statement of Financial Condition (SFC) or of Operations (SOO). Its amount is the sum
 * of its accounts on the section's side (assets debit − credit; liabilities, equity and revenue
 * credit − debit; expenses debit − credit), so contra accounts reduce it. SFC lines carry their
 * cash-flow class for the indirect Statement of Cash Flows. A computed line (the year's net
 * surplus) has no accounts.
 */
export const fsLines = pgTable(
  "fs_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statement: text("statement").$type<StatementCode>().notNull(),
    code: text("code").notNull().unique(),
    caption: text("caption").notNull(),
    sortOrder: integer("sort_order").notNull(),
    section: text("section").$type<FsSection>().notNull(),
    cashFlow: text("cash_flow").$type<CashFlowClass>(),
    computed: boolean("computed").notNull().default(false),
    ...createdColumns(),
  },
  (t) => [
    check("fs_lines_statement_chk", inList("statement", STATEMENTS)),
    check("fs_lines_section_chk", inList("section", FS_SECTIONS)),
    check("fs_lines_cash_flow_chk", sql`${t.cashFlow} IS NULL OR ${t.cashFlow} IN ('CASH', 'OPERATING', 'INVESTING', 'FINANCING')`),
    check("fs_lines_statement_section_chk", sql`(${t.statement} = 'SFC') = (${t.section} IN ('ASSETS', 'LIABILITIES', 'EQUITY'))`),
  ],
);

/** Which statement line each account rolls into (one line per account). */
export const fsLineAccounts = pgTable(
  "fs_line_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fsLineId: uuid("fs_line_id")
      .notNull()
      .references(() => fsLines.id),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id),
    ...createdColumns(),
  },
  (t) => [index("fs_line_accounts_line_idx").on(t.fsLineId)],
);

/** The business segments of the Statement of Operations. */
export const segments = pgTable("segments", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...createdColumns(),
});

/** The segment of a revenue or expense account (none: GENERAL). */
export const accountSegments = pgTable("account_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id),
  segmentCode: text("segment_code")
    .notNull()
    .references(() => segments.code),
  ...createdColumns(),
});

// ── Fixed assets ──

/** Classes of property and equipment; each has its GL accounts (property_equipment_{code}, accumulated_depreciation_{code}). */
export const assetClasses = pgTable(
  "asset_classes",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    defaultLifeMonths: integer("default_life_months").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...createdColumns(),
  },
  (t) => [check("asset_classes_life_chk", sql`${t.defaultLifeMonths} > 0`)],
);

export const ASSET_STATUSES = ["ACTIVE", "FULLY_DEPRECIATED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * The fixed-asset register. Buying an asset is posted by its DV or JV (Dr the class's property and
 * equipment account); the register depreciates it straight-line, monthly, from its acquisition month.
 */
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tag: text("tag").notNull().unique(),
    description: text("description").notNull(),
    classCode: text("class_code")
      .notNull()
      .references(() => assetClasses.code),
    acquisitionDate: date("acquisition_date", { mode: "string" }).notNull(),
    cost: money("cost").notNull(),
    salvage: money("salvage").notNull(),
    lifeMonths: integer("life_months").notNull(),
    /** Depreciation posted so far. */
    accumulated: money("accumulated").notNull().default(sql`0`),
    status: text("status").$type<AssetStatus>().notNull().default("ACTIVE"),
    ...createdColumns(),
  },
  (t) => [
    check("fixed_assets_status_chk", inList("status", ASSET_STATUSES)),
    check("fixed_assets_amounts_chk", sql`${t.cost} > 0 AND ${t.salvage} >= 0 AND ${t.salvage} < ${t.cost} AND ${t.lifeMonths} > 0 AND ${t.accumulated} >= 0 AND ${t.accumulated} <= ${t.cost} - ${t.salvage}`),
    check("fixed_assets_done_chk", sql`(${t.status} = 'FULLY_DEPRECIATED') = (${t.accumulated} = ${t.cost} - ${t.salvage})`),
  ],
);

/** One depreciation run per month (idempotent): Dr Depreciation Expense / Cr Accumulated Depreciation per class. */
export const depreciationRuns = pgTable(
  "depreciation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** YYYY-MM */
    period: text("period").notNull().unique(),
    total: money("total").notNull(),
    /** None when nothing was left to depreciate. */
    jeId: uuid("je_id").references(() => journalEntries.id),
    ranBy: uuid("ran_by")
      .notNull()
      .references(() => users.id),
    ...createdColumns(),
  },
  (t) => [check("depreciation_runs_chk", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${t.total} >= 0 AND ((${t.total} = 0) = (${t.jeId} IS NULL))`)],
);

export const assetDepreciation = pgTable(
  "asset_depreciation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => depreciationRuns.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => fixedAssets.id),
    period: text("period").notNull(),
    amount: money("amount").notNull(),
    accumulatedAfter: money("accumulated_after").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("asset_depreciation_uq").on(t.assetId, t.period), check("asset_depreciation_amount_chk", sql`${t.amount} > 0`)],
);

// ── Bank reconciliation ──

/** A bank account the coop keeps, with the GL account its book balance is in. */
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  bankName: text("bank_name").notNull(),
  accountNo: text("account_no").notNull(),
  glAccountId: uuid("gl_account_id")
    .notNull()
    .unique()
    .references(() => accounts.id),
  isActive: boolean("is_active").notNull().default(true),
  ...createdColumns(),
});

/** A month's bank statement: its ending balance and its lines. */
export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),
    period: text("period").notNull(),
    endingBalance: money("ending_balance").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("bank_statements_uq").on(t.bankAccountId, t.period)],
);

/**
 * A statement line: either one of the book's entries that cleared the bank (matched to its journal
 * line), or a bank-only item (charges, interest) the book doesn't have yet.
 */
export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id),
    lineDate: date("line_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    /** + into the account (deposit, interest), − out of it (check, charge). */
    amount: money("amount").notNull(),
    matchedLineId: uuid("matched_line_id")
      .unique()
      .references(() => journalLines.id),
    ...createdColumns(),
  },
  (t) => [check("bank_statement_lines_amount_chk", sql`${t.amount} <> 0`), index("bank_statement_lines_statement_idx").on(t.statementId)],
);

/**
 * A saved reconciliation: the bank balance + deposits in transit − outstanding checks equals the book
 * balance + the bank-only items (difference zero).
 */
export const bankRecons = pgTable(
  "bank_recons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),
    period: text("period").notNull(),
    bookBalance: money("book_balance").notNull(),
    bankBalance: money("bank_balance").notNull(),
    depositsInTransit: money("deposits_in_transit").notNull(),
    outstandingChecks: money("outstanding_checks").notNull(),
    adjustments: money("adjustments").notNull(),
    difference: money("difference").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    savedBy: uuid("saved_by")
      .notNull()
      .references(() => users.id),
    ...createdColumns(),
  },
  (t) => [
    unique("bank_recons_uq").on(t.bankAccountId, t.period),
    check("bank_recons_balanced_chk", sql`${t.difference} = 0 AND ${t.bankBalance} + ${t.depositsInTransit} - ${t.outstandingChecks} = ${t.bookBalance} + ${t.adjustments}`),
  ],
);

// ── Period close ──

export const CHECK_STATUSES = ["PASS", "FAIL"] as const;

/** The month-close checklist as it stood when the month was closed (kept for the audit). */
export const closeChecklists = pgTable(
  "close_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** YYYY-MM */
    period: text("period").notNull(),
    item: text("item").notNull(),
    status: text("status").notNull(),
    detail: text("detail"),
    by: uuid("by")
      .notNull()
      .references(() => users.id),
    at: tstz("at").notNull().defaultNow(),
    ...createdColumns(),
  },
  (t) => [check("close_checklists_status_chk", inList("status", CHECK_STATUSES)), index("close_checklists_period_idx").on(t.period)],
);

/** A fiscal year's closing entry (revenues and expenses into Undivided Net Surplus). */
export const yearEndCloses = pgTable("year_end_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  year: integer("year").notNull().unique(),
  netSurplus: money("net_surplus").notNull(),
  jeId: uuid("je_id").references(() => journalEntries.id),
  closedBy: uuid("closed_by")
    .notNull()
    .references(() => users.id),
  ...createdColumns(),
});

export type FsLine = typeof fsLines.$inferSelect;
export type FixedAsset = typeof fixedAssets.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
