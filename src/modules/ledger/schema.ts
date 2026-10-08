import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { members } from "@/modules/members/schema";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export const NORMAL_BALANCES = ["DR", "CR"] as const;
export const BOOKS = ["GJ", "CRJ", "CDJ", "SJ", "PJ"] as const;
export const JE_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export const PERIOD_STATUSES = ["OPEN", "CLOSED"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type NormalBalance = (typeof NORMAL_BALANCES)[number];
export type Book = (typeof BOOKS)[number];
export type JeStatus = (typeof JE_STATUSES)[number];

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/** Chart of accounts. Header accounts (is_postable = false) group postable ones. */
export const accounts = pgTable(
  "gl_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").$type<AccountType>().notNull(),
    normalBalance: text("normal_balance").$type<NormalBalance>().notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id),
    level: integer("level").notNull().default(1),
    isPostable: boolean("is_postable").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    scaCode: text("sca_code"),
    provisional: boolean("provisional").notNull().default(false),
    ...createdColumns(),
  },
  (t) => [
    check("gl_accounts_type_chk", inList("type", ACCOUNT_TYPES)),
    check("gl_accounts_normal_balance_chk", inList("normal_balance", NORMAL_BALANCES)),
    index("gl_accounts_parent_idx").on(t.parentId),
  ],
);

/**
 * DOMAIN §6 mapping keys → accounts. Modules post by key, never by account code.
 * `requires_member`: lines on that account form a member subsidiary ledger and must carry a member.
 */
export const accountMappings = pgTable("account_mappings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  requiresMember: boolean("requires_member").notNull().default(false),
  ...createdColumns(),
});

export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull().unique(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("OPEN"),
    ...createdColumns(),
  },
  () => [check("fiscal_years_status_chk", inList("status", PERIOD_STATUSES))],
);

/** One row per calendar month. Postings need the period of their entry date to be OPEN. */
export const periods = pgTable(
  "periods",
  {
    id: serial("id").primaryKey(),
    fiscalYearId: integer("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status").notNull().default("OPEN"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: tstz("closed_at"),
    ...createdColumns(),
  },
  (t) => [
    unique("periods_year_month_uq").on(t.year, t.month),
    check("periods_status_chk", inList("status", PERIOD_STATUSES)),
    check("periods_month_chk", sql`${t.month} BETWEEN 1 AND 12`),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Gapless per book and year; null while a manual JV is still a draft. */
    jeNo: text("je_no").unique(),
    book: text("book").$type<Book>().notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    reference: text("reference"),
    particulars: text("particulars").notNull(),
    sourceModule: text("source_module").notNull(),
    sourceId: text("source_id"),
    status: text("status").$type<JeStatus>().notNull(),
    preparedBy: uuid("prepared_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    postedAt: tstz("posted_at"),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => journalEntries.id),
    reversedById: uuid("reversed_by_id").references((): AnyPgColumn => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("journal_entries_book_chk", inList("book", BOOKS)),
    check("journal_entries_status_chk", inList("status", JE_STATUSES)),
    check("journal_entries_no_iff_posted", sql`(${t.status} = 'DRAFT') = (${t.jeNo} IS NULL)`),
    check("journal_entries_reversed_has_link", sql`(${t.status} = 'REVERSED') = (${t.reversedById} IS NOT NULL)`),
    index("journal_entries_date_idx").on(t.entryDate),
    index("journal_entries_source_idx").on(t.sourceModule, t.sourceId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    memberId: uuid("member_id").references(() => members.id),
    /** Centavos. Exactly one of debit / credit is > 0. */
    debit: bigint("debit", { mode: "bigint" }).notNull().default(sql`0`),
    credit: bigint("credit", { mode: "bigint" }).notNull().default(sql`0`),
    memo: text("memo"),
    ...createdColumns(),
  },
  (t) => [
    unique("journal_lines_je_line_uq").on(t.jeId, t.lineNo),
    check("journal_lines_amounts_chk", sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND ((${t.debit} > 0) <> (${t.credit} > 0))`),
    index("journal_lines_account_idx").on(t.accountId),
    index("journal_lines_member_idx").on(t.memberId, t.accountId),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
