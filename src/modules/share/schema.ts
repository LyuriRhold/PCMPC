import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, pgView, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns } from "@/db/columns";
import { receiptItems } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";

/**
 * Share capital (PHASE-08). The GL holds the money (Subscribed Share Capital less Subscription
 * Receivable = paid-up, member-tagged); these tables are the member share ledger. Rows are never
 * changed: a cancelled teller receipt's rows stop counting because their receipt is CANCELLED.
 */

export const SHARE_TXN_TYPES = ["SUBSCRIBE", "PAYMENT", "CBU_RETENTION", "TRANSFER_IN", "TRANSFER_OUT", "WITHDRAWAL", "ISC_CAPITALIZED", "PR_CAPITALIZED", "ADJUSTMENT"] as const;
export type ShareTxnType = (typeof SHARE_TXN_TYPES)[number];

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const shareSubscriptions = pgTable(
  "share_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    subDate: date("sub_date", { mode: "string" }).notNull(),
    shares: integer("shares").notNull(),
    parValue: money("par_value").notNull(),
    amount: money("amount").notNull(),
    status: text("status").$type<"ACTIVE" | "CANCELLED">().notNull().default("ACTIVE"),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("share_subscriptions_amount_chk", sql`${t.shares} > 0 AND ${t.parValue} > 0 AND ${t.amount} = ${t.shares} * ${t.parValue}`),
    check("share_subscriptions_status_chk", inList("status", ["ACTIVE", "CANCELLED"])),
    index("share_subscriptions_member_idx").on(t.memberId),
  ],
);

/**
 * The member share ledger. `amount` is always positive; the type says what it does:
 * SUBSCRIBE → subscribed +; PAYMENT, CBU_RETENTION, ISC/PR_CAPITALIZED → paid-up +;
 * TRANSFER_IN → both +; TRANSFER_OUT and WITHDRAWAL → both −; ADJUSTMENT → unpaid subscription cancelled (subscribed −).
 */
export const shareTransactions = pgTable(
  "share_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insertion order: rows written in one transaction share created_at. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    type: text("type").$type<ShareTxnType>().notNull(),
    amount: money("amount").notNull(),
    refNo: text("ref_no"),
    birReceiptNo: text("bir_receipt_no"),
    subscriptionId: uuid("subscription_id").references(() => shareSubscriptions.id),
    /** Set for teller payments: the row counts only while its receipt is VALID. */
    receiptItemId: uuid("receipt_item_id").references(() => receiptItems.id),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    remarks: text("remarks"),
    ...createdColumns(),
  },
  (t) => [
    check("share_transactions_type_chk", inList("type", SHARE_TXN_TYPES)),
    check("share_transactions_amount_chk", sql`${t.amount} > 0`),
    index("share_transactions_member_idx").on(t.memberId, t.txnDate),
  ],
);

export const memberFees = pgTable(
  "member_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    feeType: text("fee_type").$type<"MEMBERSHIP">().notNull(),
    amount: money("amount").notNull(),
    paidAt: date("paid_at", { mode: "string" }).notNull(),
    receiptItemId: uuid("receipt_item_id")
      .notNull()
      .references(() => receiptItems.id),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("member_fees_type_chk", inList("fee_type", ["MEMBERSHIP"])),
    check("member_fees_amount_chk", sql`${t.amount} > 0`),
    uniqueIndex("member_fees_receipt_item_uq").on(t.receiptItemId),
    index("member_fees_member_idx").on(t.memberId),
  ],
);

/** Subscribed, paid-up and unpaid subscription per member (created in migration 0018). */
export const memberShareBalance = pgView("v_member_share_balance", {
  memberId: uuid("member_id").notNull(),
  subscribed: money("subscribed").notNull(),
  paidUp: money("paid_up").notNull(),
  unpaid: money("unpaid").notNull(),
}).existing();

export type ShareTransaction = typeof shareTransactions.$inferSelect;
export type ShareSubscription = typeof shareSubscriptions.$inferSelect;
