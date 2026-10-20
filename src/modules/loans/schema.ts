import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { receiptItems } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
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
    /** Smallest loan (the deductions must fit in it; CONFIRM Q-10.9). */
    minAmount: money("min_amount").notNull().default(sql`0`),
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
    check("loan_products_amounts_chk", sql`${t.minAmount} >= 0 AND (${t.maxAmount} IS NULL OR ${t.maxAmount} >= ${t.minAmount}) AND ${t.requiredComakers} >= 0 AND ${t.graceDays} >= 0`),
  ],
);

export const DEDUCTION_CODES = ["SERVICE_FEE", "CBU", "LPP", "NOTARIAL", "OTHER"] as const;
export type DeductionCode = (typeof DEDUCTION_CODES)[number];
/** The accounts each kind of deduction may be credited to on release (DOMAIN §6). */
export const DEDUCTION_GL: Record<DeductionCode, readonly string[]> = {
  SERVICE_FEE: ["service_fee_income"],
  CBU: ["subscription_receivable_common"],
  LPP: ["lpp_insurance_payable"],
  NOTARIAL: ["notarial_fee_income"],
  OTHER: ["service_fee_income", "notarial_fee_income", "lpp_insurance_payable"],
};
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
    /** More product terms at submission, for the release and the disclosure (Phase 11). */
    receivableGlKey: text("receivable_gl_key").notNull(),
    penaltyRatePm: text("penalty_rate_pm").notNull(),
    graceDays: integer("grace_days").notNull(),
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
    /** The status the decision led to (e.g. a manager's approval above the limit → RECOMMENDED). */
    resultingStatus: text("resulting_status").$type<LoanApplicationStatus>(),
    /** The eligibility re-check at an approval. */
    eligibility: jsonb("eligibility").$type<EligibilityResult[]>(),
    ...createdColumns(),
  },
  (t) => [
    check("loan_approvals_level_chk", inList("level", APPROVAL_LEVELS)),
    check("loan_approvals_decision_chk", inList("decision", APPROVAL_DECISIONS)),
    check("loan_approvals_reject_remarks_chk", sql`${t.decision} <> 'REJECT' OR coalesce(trim(${t.remarks}), '') <> ''`),
    index("loan_approvals_application_idx").on(t.applicationId),
  ],
);

// ── Phase 11: loans, schedules, payments, penalties, aging ──

export const LOAN_STATUSES = ["PENDING", "ACTIVE", "PAST_DUE", "PAID", "RESTRUCTURED", "WRITTEN_OFF", "CANCELLED"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
/** MIGRATION: a loan brought in at the cut-off with its remaining schedule (PHASE-17). */
export const DISBURSEMENTS = ["CASH", "SAVINGS", "RESTRUCTURE", "MIGRATION"] as const;
export type Disbursement = (typeof DISBURSEMENTS)[number];

/**
 * A loan. PENDING after the release is authorized (no entry yet); ACTIVE once the proceeds are paid
 * out (or credited to savings) with the release entry; PAST_DUE while an installment is overdue;
 * then PAID, RESTRUCTURED (into a new loan) or WRITTEN_OFF. A PENDING loan can be authorized again
 * (a new first due date) or CANCELLED before its payout. Terms are copied from the application.
 */
export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanNo: text("loan_no").notNull().unique(),
    /** Null for a loan created by a restructure. */
    applicationId: uuid("application_id").references(() => loanApplications.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => loanProducts.id),
    principal: money("principal").notNull(),
    ratePm: text("rate_pm").notNull(),
    method: text("method").$type<LoanMethod>().notNull(),
    term: integer("term").notNull(),
    releaseDate: date("release_date", { mode: "string" }),
    firstDueDate: date("first_due_date", { mode: "string" }).notNull(),
    maturityDate: date("maturity_date", { mode: "string" }).notNull(),
    status: text("status").$type<LoanStatus>().notNull().default("PENDING"),
    disbursement: text("disbursement").$type<Disbursement>().notNull(),
    /** For SAVINGS: the account credited with the net proceeds. */
    savingsAccountId: uuid("savings_account_id"),
    deductions: jsonb("deductions").$type<DeductionLine[]>().notNull(),
    netProceeds: money("net_proceeds").notNull(),
    receivableGlKey: text("receivable_gl_key").notNull(),
    penaltyRatePm: text("penalty_rate_pm").notNull(),
    graceDays: integer("grace_days").notNull(),
    authorizedBy: uuid("authorized_by")
      .notNull()
      .references(() => users.id),
    releasedBy: uuid("released_by").references(() => users.id),
    /** The release (or restructure) entry. */
    jeId: uuid("je_id").references(() => journalEntries.id),
    restructuredFromId: uuid("restructured_from_id"),
    /** The Board resolution that approved the restructure (on the new loan). */
    restructureRef: text("restructure_ref"),
    writeOffRef: text("write_off_ref"),
    writeOffJeId: uuid("write_off_je_id").references(() => journalEntries.id),
    closedAt: date("closed_at", { mode: "string" }),
    ...createdColumns(),
  },
  (t) => [
    check("loans_status_chk", inList("status", LOAN_STATUSES)),
    check("loans_disbursement_chk", inList("disbursement", DISBURSEMENTS)),
    check("loans_amounts_chk", sql`${t.principal} > 0 AND ${t.term} > 0 AND ${t.netProceeds} >= 0`),
    check("loans_released_chk", sql`(${t.status} IN ('PENDING', 'CANCELLED')) = (${t.jeId} IS NULL)`),
    uniqueIndex("loans_application_uq").on(t.applicationId),
    index("loans_member_idx").on(t.memberId),
    index("loans_status_idx").on(t.status),
  ],
);

export const INSTALLMENT_STATUSES = ["OPEN", "PARTIAL", "PAID"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

/** A loan's installments. The due amounts never change; the paid amounts and penalties do. */
export const loanSchedule = pgTable(
  "loan_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id),
    no: integer("no").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    principalDue: money("principal_due").notNull(),
    interestDue: money("interest_due").notNull(),
    principalPaid: money("principal_paid").notNull().default(sql`0`),
    interestPaid: money("interest_paid").notNull().default(sql`0`),
    penaltyAccrued: money("penalty_accrued").notNull().default(sql`0`),
    penaltyPaid: money("penalty_paid").notNull().default(sql`0`),
    status: text("status").$type<InstallmentStatus>().notNull().default("OPEN"),
    ...createdColumns(),
  },
  (t) => [
    check("loan_schedule_status_chk", inList("status", INSTALLMENT_STATUSES)),
    check(
      "loan_schedule_amounts_chk",
      sql`${t.principalDue} >= 0 AND ${t.interestDue} >= 0 AND ${t.principalPaid} BETWEEN 0 AND ${t.principalDue} AND ${t.interestPaid} BETWEEN 0 AND ${t.interestDue} AND ${t.penaltyPaid} BETWEEN 0 AND ${t.penaltyAccrued}`,
    ),
    uniqueIndex("loan_schedule_loan_no_uq").on(t.loanId, t.no),
  ],
);

export const PAYMENT_KINDS = ["PAYMENT", "OFFSET", "RECOVERY"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
/** How a payment was spread over the installments (centavo strings), so a reversal is exact. */
export type PaymentAllocation = { no: number; penalty: string; interest: string; principal: string };

/** Payments on a loan (teller, offsets from share capital or savings, recoveries after a write-off). */
export const loanPayments = pgTable(
  "loan_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id),
    payDate: date("pay_date", { mode: "string" }).notNull(),
    kind: text("kind").$type<PaymentKind>().notNull().default("PAYMENT"),
    amount: money("amount").notNull(),
    penaltyPart: money("penalty_part").notNull(),
    interestPart: money("interest_part").notNull(),
    principalPart: money("principal_part").notNull(),
    allocations: jsonb("allocations").$type<PaymentAllocation[]>().notNull(),
    refNo: text("ref_no"),
    birReceiptNo: text("bir_receipt_no"),
    receiptItemId: uuid("receipt_item_id").references(() => receiptItems.id),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    /** The entry that reversed it (a cancelled receipt). */
    reversedBy: uuid("reversed_by").references(() => journalEntries.id),
    remarks: text("remarks"),
    ...createdColumns(),
  },
  (t) => [
    check("loan_payments_kind_chk", inList("kind", PAYMENT_KINDS)),
    check("loan_payments_amounts_chk", sql`${t.amount} > 0 AND ${t.penaltyPart} >= 0 AND ${t.interestPart} >= 0 AND ${t.principalPart} >= 0 AND (${t.kind} = 'RECOVERY' OR ${t.amount} = ${t.penaltyPart} + ${t.interestPart} + ${t.principalPart})`),
    index("loan_payments_loan_idx").on(t.loanId, t.seq),
  ],
);

/**
 * Daily penalty accruals per installment (a memo: income only when collected). `basis` × `days`
 * is kept so the running total is computed exactly and rounded once (no daily rounding drift).
 */
export const loanPenaltyAccruals = pgTable(
  "loan_penalty_accruals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id),
    scheduleNo: integer("schedule_no").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    /** The installment's unpaid amount the penalty was computed on. */
    basis: money("basis").notNull(),
    days: integer("days").notNull(),
    ...createdColumns(),
  },
  (t) => [check("loan_penalty_accruals_chk", sql`${t.amount} >= 0 AND ${t.basis} >= 0 AND ${t.days} > 0`), uniqueIndex("loan_penalty_accruals_uq").on(t.loanId, t.scheduleNo, t.businessDate)],
);

/** The portfolio's aging as of each business date (daily job). */
export const loanAgingSnapshots = pgTable(
  "loan_aging_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id),
    daysPastDue: integer("days_past_due").notNull(),
    bucket: text("bucket").notNull(),
    outstandingPrincipal: money("outstanding_principal").notNull(),
    /** Penalties, interest and principal of the installments overdue (null on snapshots taken before it was kept). */
    amountPastDue: money("amount_past_due"),
    ...createdColumns(),
  },
  (t) => [uniqueIndex("loan_aging_snapshots_uq").on(t.asOf, t.loanId)],
);

export type Loan = typeof loans.$inferSelect;
export type LoanScheduleRow = typeof loanSchedule.$inferSelect;
export type LoanPayment = typeof loanPayments.$inferSelect;
export type LoanProduct = typeof loanProducts.$inferSelect;
export type LoanProductDeduction = typeof loanProductDeductions.$inferSelect;
export type LoanApplication = typeof loanApplications.$inferSelect;
export type LoanApproval = typeof loanApprovals.$inferSelect;
