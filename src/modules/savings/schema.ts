import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns } from "@/db/columns";
import { receiptItems } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";

/**
 * Savings and time deposits (PHASE-09). The GL holds the money (Savings Deposits / Time Deposits,
 * member-tagged); these tables are the passbook. Transactions are never changed: a correction is a
 * new ADJUSTMENT row.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const PRODUCT_KINDS = ["SAVINGS", "TIME"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Deposit products: their rates and limits are the configuration (seeded from DOMAIN §2, edited on Savings products). */
export const depositProducts = pgTable(
  "deposit_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").$type<ProductKind>().notNull(),
    /** Yearly rate as a decimal string ("0.02" = 2%). */
    ratePa: text("rate_pa").notNull(),
    /** ADB_ACTUAL_365 (savings) or SIMPLE_ACTUAL_365 (time deposits). */
    interestBasis: text("interest_basis").notNull(),
    /** QUARTERLY (savings) or AT_MATURITY (time deposits). */
    crediting: text("crediting").notNull(),
    minBalanceEarn: money("min_balance_earn").notNull().default(sql`0`),
    maintainingBalance: money("maintaining_balance").notNull().default(sql`0`),
    dormantAfterMonths: integer("dormant_after_months"),
    wtaxRate: text("wtax_rate").notNull().default("0"),
    /** DOMAIN §6 mapping keys. */
    depositGlKey: text("deposit_gl_key").notNull(),
    interestGlKey: text("interest_gl_key").notNull(),
    wtaxGlKey: text("wtax_gl_key").notNull(),
    active: boolean("active").notNull().default(true),
    ...createdColumns(),
  },
  (t) => [
    check("deposit_products_kind_chk", inList("kind", PRODUCT_KINDS)),
    check("deposit_products_amounts_chk", sql`${t.minBalanceEarn} >= 0 AND ${t.maintainingBalance} >= 0`),
  ],
);

export const DEPOSIT_ACCOUNT_STATUSES = ["OPEN", "DORMANT", "CLOSED"] as const;
export type DepositAccountStatus = (typeof DEPOSIT_ACCOUNT_STATUSES)[number];

export const depositAccounts = pgTable(
  "deposit_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountNo: text("account_no").notNull().unique(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => depositProducts.id),
    status: text("status").$type<DepositAccountStatus>().notNull().default("OPEN"),
    openedAt: date("opened_at", { mode: "string" }).notNull(),
    closedAt: date("closed_at", { mode: "string" }),
    /** Last deposit or withdrawal by the member (interest doesn't count); dormancy starts from it. */
    lastCustomerTxnAt: date("last_customer_txn_at", { mode: "string" }),
    ...createdColumns(),
  },
  (t) => [
    check("deposit_accounts_status_chk", inList("status", DEPOSIT_ACCOUNT_STATUSES)),
    check("deposit_accounts_closed_chk", sql`(${t.status} = 'CLOSED') = (${t.closedAt} IS NOT NULL)`),
    index("deposit_accounts_member_idx").on(t.memberId),
  ],
);

export const DEPOSIT_TXN_TYPES = ["DEPOSIT", "WITHDRAWAL", "INTEREST", "WTAX", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"] as const;
export type DepositTxnType = (typeof DEPOSIT_TXN_TYPES)[number];

/**
 * The passbook. `amount` is signed: + adds to the balance (DEPOSIT, INTEREST, TRANSFER_IN),
 * − takes from it (WITHDRAWAL, WTAX, TRANSFER_OUT); an ADJUSTMENT can be either.
 */
export const depositTransactions = pgTable(
  "deposit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insertion order (the passbook order; rows written in one transaction share created_at). */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => depositAccounts.id),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    type: text("type").$type<DepositTxnType>().notNull(),
    amount: money("amount").notNull(),
    balanceAfter: money("balance_after").notNull(),
    refNo: text("ref_no"),
    birReceiptNo: text("bir_receipt_no"),
    /** Set for teller deposits. */
    receiptItemId: uuid("receipt_item_id").references(() => receiptItems.id),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    remarks: text("remarks"),
    ...createdColumns(),
  },
  (t) => [
    check("deposit_transactions_type_chk", inList("type", DEPOSIT_TXN_TYPES)),
    check(
      "deposit_transactions_sign_chk",
      sql`${t.amount} <> 0 AND (${t.type} = 'ADJUSTMENT' OR (${t.type} IN ('DEPOSIT', 'INTEREST', 'TRANSFER_IN') AND ${t.amount} > 0) OR (${t.type} IN ('WITHDRAWAL', 'WTAX', 'TRANSFER_OUT') AND ${t.amount} < 0))`,
    ),
    check("deposit_transactions_balance_chk", sql`${t.balanceAfter} >= 0`),
    index("deposit_transactions_account_idx").on(t.accountId, t.seq),
  ],
);

export const TD_STATUSES = ["ACTIVE", "MATURED", "PRETERMINATED", "ROLLED_OVER"] as const;
export type TdStatus = (typeof TD_STATUSES)[number];

/**
 * A time-deposit certificate on a TD account. It is funded from the member's savings account and,
 * when it ends, the principal and interest go back to that account (or into a new certificate on a
 * rollover). Only the closing fields change after placement (trigger).
 */
export const timeDeposits = pgTable(
  "time_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => depositAccounts.id),
    certificateNo: text("certificate_no").notNull(),
    principal: money("principal").notNull(),
    ratePa: text("rate_pa").notNull(),
    termDays: integer("term_days").notNull(),
    placementDate: date("placement_date", { mode: "string" }).notNull(),
    maturityDate: date("maturity_date", { mode: "string" }).notNull(),
    status: text("status").$type<TdStatus>().notNull().default("ACTIVE"),
    /** Gross interest paid when it ended. */
    interestPaid: money("interest_paid").notNull().default(sql`0`),
    /** The savings account it was funded from and pays back to. */
    savingsAccountId: uuid("savings_account_id")
      .notNull()
      .references(() => depositAccounts.id),
    rolledFromId: uuid("rolled_from_id"),
    /** The entry that placed it (for a rollover, the entry that ended the previous certificate). */
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    closedAt: date("closed_at", { mode: "string" }),
    closeJeId: uuid("close_je_id").references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("time_deposits_status_chk", inList("status", TD_STATUSES)),
    check("time_deposits_amounts_chk", sql`${t.principal} > 0 AND ${t.termDays} > 0 AND ${t.interestPaid} >= 0`),
    check("time_deposits_closed_chk", sql`(${t.status} = 'ACTIVE') = (${t.closedAt} IS NULL)`),
    uniqueIndex("time_deposits_certificate_uq").on(t.certificateNo),
    index("time_deposits_account_idx").on(t.accountId),
    index("time_deposits_savings_account_idx").on(t.savingsAccountId),
  ],
);

export type DepositProduct = typeof depositProducts.$inferSelect;
export type DepositAccount = typeof depositAccounts.$inferSelect;
export type DepositTransaction = typeof depositTransactions.$inferSelect;
export type TimeDeposit = typeof timeDeposits.$inferSelect;
