import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { accounts, journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";

export const SESSION_STATUSES = ["OPEN", "CLOSED", "VERIFIED"] as const;
export const RECEIPT_MODES = ["CASH", "CHECK", "BANK_TRANSFER"] as const;
export const RECEIPT_STATUSES = ["VALID", "CANCELLED"] as const;
export const DV_STATUSES = ["DRAFT", "APPROVED", "RELEASED", "CANCELLED"] as const;
export const DV_MODES = ["CASH", "CHECK"] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type ReceiptMode = (typeof RECEIPT_MODES)[number];
export type DvStatus = (typeof DV_STATUSES)[number];
export type DvMode = (typeof DV_MODES)[number];

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

/** A teller's working session for one business date. Cash in and out needs an OPEN session. */
export const tellerSessions = pgTable(
  "teller_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tellerId: uuid("teller_id")
      .notNull()
      .references(() => users.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    openingCash: money("opening_cash").notNull(),
    status: text("status").$type<SessionStatus>().notNull().default("OPEN"),
    expectedCash: money("expected_cash"),
    countedCash: money("counted_cash"),
    variance: money("variance"),
    closedAt: tstz("closed_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: tstz("verified_at"),
    /** Short/over posting made on verification (null when there was no variance). */
    varianceJeId: uuid("variance_je_id").references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    uniqueIndex("teller_sessions_one_open_uq").on(t.tellerId).where(sql`${t.status} = 'OPEN'`),
    index("teller_sessions_date_idx").on(t.businessDate),
    check("teller_sessions_status_chk", inList("status", SESSION_STATUSES)),
    check("teller_sessions_opening_chk", sql`${t.openingCash} >= 0`),
  ],
);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey(),
    receiptNo: text("receipt_no").notNull().unique(),
    birReceiptNo: text("bir_receipt_no"),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tellerSessions.id),
    payorType: text("payor_type").notNull(),
    payorId: text("payor_id"),
    payorName: text("payor_name").notNull(),
    receiptDate: date("receipt_date", { mode: "string" }).notNull(),
    total: money("total").notNull(),
    mode: text("mode").$type<ReceiptMode>().notNull(),
    checkNo: text("check_no"),
    status: text("status").$type<(typeof RECEIPT_STATUSES)[number]>().notNull().default("VALID"),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    cancelJeId: uuid("cancel_je_id").references(() => journalEntries.id),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: tstz("cancelled_at"),
    ...createdColumns(),
  },
  (t) => [
    index("receipts_session_idx").on(t.sessionId),
    index("receipts_date_idx").on(t.receiptDate),
    index("receipts_payor_idx").on(t.payorType, t.payorId),
    check("receipts_mode_chk", inList("mode", RECEIPT_MODES)),
    check("receipts_status_chk", inList("status", RECEIPT_STATUSES)),
    check("receipts_total_chk", sql`${t.total} > 0`),
    check("receipts_cancel_chk", sql`(${t.status} = 'CANCELLED') = (${t.cancelJeId} IS NOT NULL)`),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id),
    lineNo: integer("line_no").notNull(),
    type: text("type").notNull(),
    refId: text("ref_id"),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    breakdown: jsonb("breakdown"),
    ...createdColumns(),
  },
  (t) => [
    unique("receipt_items_line_uq").on(t.receiptId, t.lineNo),
    index("receipt_items_type_idx").on(t.type, t.refId),
    check("receipt_items_amount_chk", sql`${t.amount} > 0`),
  ],
);

/** Cash leaving a teller's drawer (DV cash release, bank deposit, later: loan proceeds, withdrawals). */
export const cashOuts = pgTable(
  "cash_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tellerSessions.id),
    type: text("type").notNull(),
    refId: text("ref_id"),
    reference: text("reference"),
    amount: money("amount").notNull(),
    outDate: date("out_date", { mode: "string" }).notNull(),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [index("cash_outs_session_idx").on(t.sessionId), check("cash_outs_amount_chk", sql`${t.amount} > 0`)],
);

export const disbursementVouchers = pgTable(
  "disbursement_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dvNo: text("dv_no").notNull().unique(),
    dvDate: date("dv_date", { mode: "string" }).notNull(),
    payee: text("payee").notNull(),
    particulars: text("particulars").notNull(),
    amount: money("amount").notNull(),
    mode: text("mode").$type<DvMode>().notNull(),
    checkNo: text("check_no"),
    status: text("status").$type<DvStatus>().notNull().default("DRAFT"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    releasedBy: uuid("released_by").references(() => users.id),
    releasedAt: tstz("released_at"),
    sessionId: uuid("session_id").references(() => tellerSessions.id),
    jeId: uuid("je_id").references(() => journalEntries.id),
    cancelReason: text("cancel_reason"),
    ...createdColumns(),
  },
  (t) => [
    check("dv_status_chk", inList("status", DV_STATUSES)),
    check("dv_mode_chk", inList("mode", DV_MODES)),
    check("dv_amount_chk", sql`${t.amount} > 0`),
    check("dv_released_has_je", sql`(${t.status} = 'RELEASED') = (${t.jeId} IS NOT NULL)`),
  ],
);

/** Debit lines of a DV; the credit side is Cash on Hand (CASH) or Cash in Bank (CHECK). */
export const dvLines = pgTable(
  "dv_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dvId: uuid("dv_id")
      .notNull()
      .references(() => disbursementVouchers.id),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    memberId: uuid("member_id").references(() => members.id),
    amount: money("amount").notNull(),
    memo: text("memo"),
    ...createdColumns(),
  },
  (t) => [unique("dv_lines_line_uq").on(t.dvId, t.lineNo), check("dv_lines_amount_chk", sql`${t.amount} > 0`)],
);

export const cashCounts = pgTable(
  "cash_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tellerSessions.id),
    /** Face value in centavos (₱1,000 = 100000, ₱0.25 = 25). */
    denomination: money("denomination").notNull(),
    qty: integer("qty").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("cash_counts_session_denom_uq").on(t.sessionId, t.denomination), check("cash_counts_qty_chk", sql`${t.qty} >= 0`)],
);

export type TellerSession = typeof tellerSessions.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type ReceiptItemRow = typeof receiptItems.$inferSelect;
export type DisbursementVoucher = typeof disbursementVouchers.$inferSelect;
