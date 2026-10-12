import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { members } from "@/modules/members/schema";

/**
 * Loan products and applications (PHASE-10). Nothing here moves money: release, payments and
 * penalties are Phase 11. An application keeps a snapshot of everything it was decided on
 * (rate, method, eligibility, schedule, deductions); after submission only its status changes.
 */

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const LOAN_METHODS = ["DIMINISHING_EQUAL_AMORT", "DIMINISHING_EQUAL_PRINCIPAL", "ADD_ON"] as const;
export type LoanMethod = (typeof LOAN_METHODS)[number];

export const loanProducts = pgTable(
  "loan_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    method: text("method").$type<LoanMethod>().notNull(),
    /** Monthly rate as a decimal string ("0.015" = 1.5% a month). */
    ratePm: text("rate_pm").notNull(),
    minTerm: integer("min_term").notNull(),
    maxTerm: integer("max_term").notNull(),
    /** MONTHLY only (others CONFIRM). */
    frequency: text("frequency").notNull().default("MONTHLY"),
    maxAmount: money("max_amount"),
    /** Loanable amount as a multiple of paid-up share capital ("3" = 3×); null = no such limit. */
    maxMultipleOfPaidUp: text("max_multiple_of_paid_up"),
    requiredComakers: integer("required_comakers").notNull().default(0),
    /** Penalty on overdue amortization per month (Phase 11), decimal string. */
    penaltyRatePm: text("penalty_rate_pm").notNull(),
    graceDays: integer("grace_days").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /** DOMAIN §6 mapping key of the receivable (loans_receivable_{code}). */
    receivableGlKey: text("receivable_gl_key").notNull(),
    ...createdColumns(),
  },
  (t) => [
    check("loan_products_method_chk", inList("method", LOAN_METHODS)),
    check("loan_products_terms_chk", sql`${t.minTerm} >= 1 AND ${t.maxTerm} >= ${t.minTerm}`),
    check("loan_products_frequency_chk", sql`${t.frequency} = 'MONTHLY'`),
    check("loan_products_amounts_chk", sql`(${t.maxAmount} IS NULL OR ${t.maxAmount} > 0) AND ${t.requiredComakers} >= 0 AND ${t.graceDays} >= 0`),
  ],
);

export const DEDUCTION_CODES = ["SERVICE_FEE", "CBU", "LPP", "NOTARIAL", "OTHER"] as const;
export type DeductionCode = (typeof DEDUCTION_CODES)[number];
export const DEDUCTION_BASES = ["PCT_OF_PRINCIPAL", "FIXED"] as const;
export type DeductionBasis = (typeof DEDUCTION_BASES)[number];

/** Deductions taken from the principal on release. `value` is a rate ("0.02") or, for FIXED, centavos ("10000"). */
export const loanProductDeductions = pgTable(
  "loan_product_deductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => loanProducts.id),
    code: text("code").$type<DeductionCode>().notNull(),
    name: text("name").notNull(),
    basis: text("basis").$type<DeductionBasis>().notNull(),
    value: text("value").notNull(),
    /** DOMAIN §6 mapping key credited on release. */
    glKey: text("gl_key").notNull(),
    sort: integer("sort").notNull().default(0),
    ...createdColumns(),
  },
  (t) => [
    check("loan_product_deductions_code_chk", inList("code", DEDUCTION_CODES)),
    check("loan_product_deductions_basis_chk", inList("basis", DEDUCTION_BASES)),
    index("loan_product_deductions_product_idx").on(t.productId),
  ],
);

export const LOAN_APPLICATION_STATUSES = ["SUBMITTED", "RECOMMENDED", "APPROVED", "REJECTED", "CANCELLED", "RELEASED"] as const;
export type LoanApplicationStatus = (typeof LOAN_APPLICATION_STATUSES)[number];

/** Snapshots stored on an application (JSON: money as centavo strings). */
export type EligibilityResult = { rule: string; pass: boolean; message: string };
export type SchedulePreviewRow = { no: number; dueDate: string; principal: string; interest: string; payment: string; balance: string };
export type DeductionLine = { code: string; name: string; amount: string; glKey: string };

export const loanApplications = pgTable(
  "loan_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appNo: text("app_no").notNull().unique(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => loanProducts.id),
    amount: money("amount").notNull(),
    term: integer("term").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").$type<LoanApplicationStatus>().notNull().default("SUBMITTED"),
    /** Product terms at submission. */
    method: text("method").$type<LoanMethod>().notNull(),
    ratePm: text("rate_pm").notNull(),
    /** Tentative first due date for the preview; the release (Phase 11) sets the real schedule. */
    firstDueDate: date("first_due_date", { mode: "string" }).notNull(),
    eligibility: jsonb("eligibility").$type<EligibilityResult[]>().notNull(),
    schedulePreview: jsonb("schedule_preview").$type<SchedulePreviewRow[]>().notNull(),
    deductions: jsonb("deductions").$type<DeductionLine[]>().notNull(),
    netProceeds: money("net_proceeds").notNull(),
    totalInterest: money("total_interest").notNull(),
    encodedBy: uuid("encoded_by")
      .notNull()
      .references(() => users.id),
    ...createdColumns(),
  },
  (t) => [
    check("loan_applications_status_chk", inList("status", LOAN_APPLICATION_STATUSES)),
    check("loan_applications_amounts_chk", sql`${t.amount} > 0 AND ${t.term} > 0 AND ${t.netProceeds} >= 0 AND ${t.totalInterest} >= 0`),
    index("loan_applications_member_idx").on(t.memberId),
    index("loan_applications_status_idx").on(t.status),
  ],
);

export const loanApplicationComakers = pgTable(
  "loan_application_comakers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => loanApplications.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    ...createdColumns(),
  },
  (t) => [uniqueIndex("loan_application_comakers_uq").on(t.applicationId, t.memberId), index("loan_application_comakers_member_idx").on(t.memberId)],
);

export const APPROVAL_LEVELS = ["MANAGER", "CREDIT_COMMITTEE"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];
export const APPROVAL_DECISIONS = ["APPROVE", "REJECT"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Every approval decision on an application (insert-only). */
export const loanApprovals = pgTable(
  "loan_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => loanApplications.id),
    level: text("level").$type<ApprovalLevel>().notNull(),
    decision: text("decision").$type<ApprovalDecision>().notNull(),
    remarks: text("remarks"),
    by: uuid("by")
      .notNull()
      .references(() => users.id),
    at: tstz("at").notNull().defaultNow(),
    ...createdColumns(),
  },
  (t) => [
    check("loan_approvals_level_chk", inList("level", APPROVAL_LEVELS)),
    check("loan_approvals_decision_chk", inList("decision", APPROVAL_DECISIONS)),
    check("loan_approvals_reject_remarks_chk", sql`${t.decision} <> 'REJECT' OR coalesce(trim(${t.remarks}), '') <> ''`),
    index("loan_approvals_application_idx").on(t.applicationId),
  ],
);

export type LoanProduct = typeof loanProducts.$inferSelect;
export type LoanProductDeduction = typeof loanProductDeductions.$inferSelect;
export type LoanApplication = typeof loanApplications.$inferSelect;
export type LoanApproval = typeof loanApprovals.$inferSelect;
