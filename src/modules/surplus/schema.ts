import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { disbursementVouchers } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";
import { depositAccounts } from "@/modules/savings/schema";

/**
 * Net surplus allocation (PHASE-15): one allocation per fiscal year, from the net surplus the
 * year-end close moved into Undivided Net Surplus, to the statutory funds (RA 9520) and the pools of
 * interest on share capital (by ASM) and patronage refund (by patronage); one line per member with
 * their ISC and PR, their payout election and, once distributed, how it was paid. Percentages and
 * rates are decimal strings (fractions: "0.10" is 10%); amounts are centavos.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const ALLOCATION_STATUSES = ["DRAFT", "APPROVED", "POSTED", "DISTRIBUTED"] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/** What counts as a member's patronage (setting surplus.pr_basis, kept with the allocation). */
export type PrBasis = { loanInterestPaid: boolean; netStorePurchases: boolean; waterBillsPaidByMembers: boolean };

export const surplusAllocations = pgTable(
  "surplus_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fiscalYear: integer("fiscal_year").notNull().unique(),
    netSurplus: money("net_surplus").notNull(),
    // The percentages applied (GA-approved; the settings by default).
    reservePct: text("reserve_pct").notNull(),
    etfPct: text("etf_pct").notNull(),
    cdfPct: text("cdf_pct").notNull(),
    optionalPct: text("optional_pct").notNull(),
    iscShare: text("isc_share").notNull(),
    prShare: text("pr_share").notNull(),
    prBasis: jsonb("pr_basis").$type<PrBasis>().notNull(),
    wtaxRate: text("wtax_rate").notNull(),
    offsetArrears: boolean("offset_arrears").notNull(),
    // The split.
    reserve: money("reserve").notNull(),
    etfLocal: money("etf_local").notNull(),
    cetf: money("cetf").notNull(),
    cdf: money("cdf").notNull(),
    optional: money("optional").notNull(),
    remaining: money("remaining").notNull(),
    iscPool: money("isc_pool").notNull(),
    prPool: money("pr_pool").notNull(),
    /** ISC pool ÷ Σ ASM and PR pool ÷ Σ patronage (fractions). */
    iscRate: text("isc_rate").notNull(),
    prRate: text("pr_rate").notNull(),
    status: text("status").$type<AllocationStatus>().notNull().default("DRAFT"),
    gaResolutionNo: text("ga_resolution_no"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: tstz("posted_at"),
    /** Dr Undivided Net Surplus / Cr the funds, CETF payable, ISC payable and PR payable. */
    jeId: uuid("je_id").references(() => journalEntries.id),
    distributedBy: uuid("distributed_by").references(() => users.id),
    distributedAt: tstz("distributed_at"),
    ...createdColumns(),
  },
  (t) => [
    check("surplus_allocations_status_chk", inList("status", ALLOCATION_STATUSES)),
    check(
      "surplus_allocations_split_chk",
      sql`${t.netSurplus} > 0 AND ${t.reserve} >= 0 AND ${t.etfLocal} >= 0 AND ${t.cetf} >= 0 AND ${t.cdf} >= 0 AND ${t.optional} >= 0 AND ${t.iscPool} >= 0 AND ${t.prPool} >= 0 AND ${t.reserve} + ${t.etfLocal} + ${t.cetf} + ${t.cdf} + ${t.optional} + ${t.remaining} = ${t.netSurplus} AND ${t.iscPool} + ${t.prPool} = ${t.remaining}`,
    ),
    check("surplus_allocations_sod_chk", sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ${t.preparedBy}`),
    check("surplus_allocations_posted_chk", sql`(${t.status} IN ('POSTED', 'DISTRIBUTED')) = (${t.jeId} IS NOT NULL) AND (${t.jeId} IS NULL OR (${t.gaResolutionNo} IS NOT NULL AND ${t.approvedBy} IS NOT NULL))`),
  ],
);

/** A member's ISC and PR in a year's allocation, their payout election (basis points) and how it was paid. */
export const surplusMemberLines = pgTable(
  "surplus_member_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => surplusAllocations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    asm: money("asm").notNull(),
    isc: money("isc").notNull(),
    patronageLoanInterest: money("patronage_loan_interest").notNull(),
    patronageStore: money("patronage_store").notNull(),
    patronageWater: money("patronage_water").notNull(),
    patronageTotal: money("patronage_total").notNull(),
    pr: money("pr").notNull(),
    gross: money("gross").notNull(),
    /** The member's election, in basis points (100% = 10000). */
    electSavings: integer("elect_savings").notNull(),
    electCapitalize: integer("elect_capitalize").notNull(),
    electCash: integer("elect_cash").notNull(),
    // Set when distributed (before: net = gross, the rest 0).
    wtax: money("wtax").notNull().default(sql`0`),
    arrearsOffset: money("arrears_offset").notNull().default(sql`0`),
    net: money("net").notNull(),
    payoutSavings: money("payout_savings").notNull().default(sql`0`),
    payoutCapitalize: money("payout_capitalize").notNull().default(sql`0`),
    payoutCash: money("payout_cash").notNull().default(sql`0`),
    savingsAccountId: uuid("savings_account_id").references(() => depositAccounts.id),
    /** The distribution entry (withholding, arrears, savings, capital) and the cash DV. */
    jeId: uuid("je_id").references(() => journalEntries.id),
    dvId: uuid("dv_id").references(() => disbursementVouchers.id),
    distributedAt: tstz("distributed_at"),
    ...createdColumns(),
  },
  (t) => [
    unique("surplus_member_lines_uq").on(t.allocationId, t.memberId),
    index("surplus_member_lines_member_idx").on(t.memberId),
    check(
      "surplus_member_lines_amounts_chk",
      sql`${t.asm} >= 0 AND ${t.isc} >= 0 AND ${t.patronageLoanInterest} >= 0 AND ${t.patronageStore} >= 0 AND ${t.patronageWater} >= 0 AND ${t.patronageTotal} >= 0 AND ${t.pr} >= 0 AND ${t.gross} = ${t.isc} + ${t.pr} AND ${t.gross} > 0 AND ${t.wtax} >= 0 AND ${t.arrearsOffset} >= 0 AND ${t.net} = ${t.gross} - ${t.wtax} - ${t.arrearsOffset} AND ${t.net} >= 0 AND ${t.payoutSavings} >= 0 AND ${t.payoutCapitalize} >= 0 AND ${t.payoutCash} >= 0`,
    ),
    check("surplus_member_lines_election_chk", sql`${t.electSavings} >= 0 AND ${t.electCapitalize} >= 0 AND ${t.electCash} >= 0 AND ${t.electSavings} + ${t.electCapitalize} + ${t.electCash} = 10000`),
    check("surplus_member_lines_paid_chk", sql`${t.distributedAt} IS NULL OR ${t.payoutSavings} + ${t.payoutCapitalize} + ${t.payoutCash} = ${t.net}`),
  ],
);

/** A remittance of a year's CETF to the federation/union, paid by a disbursement voucher. */
export const cetfRemittances = pgTable(
  "cetf_remittances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => surplusAllocations.id),
    dvId: uuid("dv_id")
      .notNull()
      .unique()
      .references(() => disbursementVouchers.id),
    amount: money("amount").notNull(),
    ...createdColumns(),
  },
  (t) => [check("cetf_remittances_amount_chk", sql`${t.amount} > 0`), index("cetf_remittances_allocation_idx").on(t.allocationId)],
);

export type SurplusAllocation = typeof surplusAllocations.$inferSelect;
export type SurplusMemberLine = typeof surplusMemberLines.$inferSelect;
