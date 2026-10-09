import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, serial, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { disbursementVouchers, receiptItems } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";

export const CUSTOMER_TYPES = ["MEMBER", "NON_MEMBER"] as const;
export const CLASSIFICATIONS = ["RESIDENTIAL", "COMMERCIAL", "INSTITUTIONAL", "BULK"] as const;
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "DISCONNECTED", "CLOSED"] as const;
export const APPLICATION_STATUSES = ["APPLIED", "INSPECTED", "APPROVED", "INSTALLED", "REJECTED"] as const;
export const METER_STATUSES = ["IN_STOCK", "INSTALLED", "DEFECTIVE", "RETIRED"] as const;
/** Who a tariff version applies to: everyone, or only members / non-members (separate rates). */
export const TARIFF_APPLIES_TO = ["ALL", "MEMBER", "NON_MEMBER"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type MeterStatus = (typeof METER_STATUSES)[number];
export type TariffAppliesTo = (typeof TARIFF_APPLIES_TO)[number];
/** Rate block: m³ from..to (inclusive; to null = no upper limit) at `rate` centavos per m³. */
export type RateBlock = { from: number; to: number | null; rate: string };

const inList = (col: string, values: readonly string[]) => sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);
const money = (name: string) => bigint(name, { mode: "bigint" });

export const waterCustomers = pgTable(
  "water_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerNo: text("customer_no").notNull().unique(),
    type: text("type").$type<CustomerType>().notNull(),
    memberId: uuid("member_id").references(() => members.id),
    lastName: text("last_name"),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    businessName: text("business_name"),
    /** normalized name + address, for the duplicate check */
    nameKey: text("name_key").notNull(),
    /** normalized customer no. + names, for search */
    searchText: text("search_text").notNull(),
    address: text("address").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    validIdType: text("valid_id_type"),
    validIdNo: text("valid_id_no"),
    privacyConsentAt: tstz("privacy_consent_at"),
    remarks: text("remarks"),
    ...createdColumns(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // A member has at most one water customer record (MEMBER rows only; history keeps member_id).
    uniqueIndex("water_customers_member_uq").on(t.memberId).where(sql`${t.type} = 'MEMBER'`),
    index("water_customers_name_key_idx").on(t.nameKey),
    check("water_customers_type_chk", inList("type", CUSTOMER_TYPES)),
    check("water_customers_member_link_chk", sql`${t.type} <> 'MEMBER' OR ${t.memberId} IS NOT NULL`),
    check("water_customers_name_chk", sql`(${t.lastName} IS NOT NULL AND ${t.firstName} IS NOT NULL) OR ${t.businessName} IS NOT NULL`),
  ],
);

export const waterZones = pgTable("water_zones", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...createdColumns(),
});

export const waterRoutes = pgTable("water_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: integer("zone_id")
    .notNull()
    .references(() => waterZones.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  assignedReaderId: uuid("assigned_reader_id").references(() => users.id),
  ...createdColumns(),
});

export const waterAccounts = pgTable(
  "water_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountNo: text("account_no").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => waterCustomers.id),
    classification: text("classification").$type<Classification>().notNull(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => waterRoutes.id),
    /** Reading order within the route. */
    sequenceNo: integer("sequence_no").notNull(),
    serviceAddress: text("service_address").notNull(),
    status: text("status").$type<AccountStatus>().notNull().default("PENDING"),
    connectedAt: date("connected_at", { mode: "string" }),
    closedAt: date("closed_at", { mode: "string" }),
    /** Meter deposit held (Customers' Deposits sub-ledger), in centavos. */
    depositAmount: money("deposit_amount").notNull().default(sql`0`),
    applicationId: uuid("application_id"),
    ...createdColumns(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("water_accounts_route_seq_idx").on(t.routeId, t.sequenceNo),
    index("water_accounts_customer_idx").on(t.customerId),
    check("water_accounts_class_chk", inList("classification", CLASSIFICATIONS)),
    check("water_accounts_status_chk", inList("status", ACCOUNT_STATUSES)),
    check("water_accounts_deposit_chk", sql`${t.depositAmount} >= 0`),
  ],
);

export const waterApplications = pgTable(
  "water_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appNo: text("app_no").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => waterCustomers.id),
    classification: text("classification").$type<Classification>().notNull(),
    serviceAddress: text("service_address").notNull(),
    routeId: uuid("route_id").references(() => waterRoutes.id),
    status: text("status").$type<ApplicationStatus>().notNull().default("APPLIED"),
    inspectionNotes: text("inspection_notes"),
    inspectedBy: uuid("inspected_by").references(() => users.id),
    inspectedAt: tstz("inspected_at"),
    encodedBy: uuid("encoded_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    rejectedReason: text("rejected_reason"),
    accountId: uuid("account_id").references(() => waterAccounts.id),
    installedAt: date("installed_at", { mode: "string" }),
    ...createdColumns(),
  },
  (t) => [
    check("water_applications_status_chk", inList("status", APPLICATION_STATUSES)),
    check("water_applications_class_chk", inList("classification", CLASSIFICATIONS)),
    index("water_applications_status_idx").on(t.status),
  ],
);

export const waterMeters = pgTable(
  "water_meters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serialNo: text("serial_no").notNull().unique(),
    brand: text("brand"),
    size: text("size"),
    /** Dial digits; readings run 0 … 10^digits − 1 and then roll over. */
    digits: integer("digits").notNull().default(4),
    status: text("status").$type<MeterStatus>().notNull().default("IN_STOCK"),
    ...createdColumns(),
  },
  (t) => [check("water_meters_status_chk", inList("status", METER_STATUSES)), check("water_meters_digits_chk", sql`${t.digits} BETWEEN 3 AND 9`)],
);

export const waterMeterInstallations = pgTable(
  "water_meter_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => waterMeters.id),
    installedAt: date("installed_at", { mode: "string" }).notNull(),
    initialReading: integer("initial_reading").notNull(),
    removedAt: date("removed_at", { mode: "string" }),
    finalReading: integer("final_reading"),
    reason: text("reason"),
    ...createdColumns(),
  },
  (t) => [
    // A meter is at one account at a time, and an account has one meter at a time.
    uniqueIndex("water_installations_meter_active_uq").on(t.meterId).where(sql`${t.removedAt} IS NULL`),
    uniqueIndex("water_installations_account_active_uq").on(t.accountId).where(sql`${t.removedAt} IS NULL`),
    check("water_installations_readings_chk", sql`${t.initialReading} >= 0 AND (${t.finalReading} IS NULL OR ${t.finalReading} >= 0)`),
    check("water_installations_removed_chk", sql`(${t.removedAt} IS NULL) = (${t.finalReading} IS NULL)`),
  ],
);

/** NWRB-approved tariff versions. Insert-only: a change is a new version with a later effective date. */
export const waterRateSchedules = pgTable(
  "water_rate_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classification: text("classification").$type<Classification>().notNull(),
    /** ALL, or a members-only / non-members-only version (PCMPC: members pay a lower minimum). */
    appliesTo: text("applies_to").$type<TariffAppliesTo>().notNull().default("ALL"),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    minCharge: money("min_charge").notNull(),
    minCubic: integer("min_cubic").notNull(),
    blocks: jsonb("blocks").$type<RateBlock[]>().notNull(),
    nwrbRef: text("nwrb_ref").notNull(),
    approvedAt: tstz("approved_at"),
    ...createdColumns(),
  },
  (t) => [
    unique("water_rate_schedules_version_uq").on(t.classification, t.appliesTo, t.effectiveFrom),
    check("water_rate_schedules_class_chk", inList("classification", CLASSIFICATIONS)),
    check("water_rate_schedules_applies_chk", inList("applies_to", TARIFF_APPLIES_TO)),
    check("water_rate_schedules_amounts_chk", sql`${t.minCharge} >= 0 AND ${t.minCubic} >= 0`),
  ],
);

export const waterFees = pgTable("water_fees", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  amount: money("amount").notNull(),
  /** DOMAIN §6 posting key credited when the fee is collected. */
  mappingKey: text("mapping_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...createdColumns(),
});

export const waterSeniorEligibility = pgTable(
  "water_senior_eligibility",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    seniorName: text("senior_name").notNull(),
    oscaIdNo: text("osca_id_no").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    ...createdColumns(),
  },
  (t) => [index("water_senior_account_idx").on(t.accountId), check("water_senior_dates_chk", sql`${t.validUntil} >= ${t.validFrom}`)],
);

export const waterAccountHistory = pgTable(
  "water_account_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    event: text("event").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    ref: text("ref"),
    at: tstz("at").notNull(),
    by: uuid("by").references(() => users.id),
    ...createdColumns(),
  },
  (t) => [index("water_account_history_idx").on(t.accountId, t.at)],
);

export type WaterCustomer = typeof waterCustomers.$inferSelect;
export type WaterAccount = typeof waterAccounts.$inferSelect;
export type WaterApplication = typeof waterApplications.$inferSelect;
export type WaterMeter = typeof waterMeters.$inferSelect;
export type RateSchedule = typeof waterRateSchedules.$inferSelect;

// ── Meter reading & billing (Phase 06) ──────────────────────────────────────────────────────

export const BILLING_PERIOD_STATUSES = ["OPEN", "READING", "REVIEW", "BILLED", "CLOSED"] as const;
export const READING_TYPES = ["ACTUAL", "ESTIMATED", "METER_CHANGE", "FINAL"] as const;
export const READING_FLAGS = ["LOWER", "HIGH", "LOW", "ZERO"] as const;
export const READING_STATUSES = ["ENTERED", "APPROVED", "REJECTED"] as const;
export const BILL_STATUSES = ["UNPAID", "PARTIAL", "PAID", "CANCELLED"] as const;
export const BILL_LINE_KINDS = ["MIN_CHARGE", "BLOCK", "SENIOR_DISCOUNT", "OTHER_FEE", "ADVANCE_APPLIED", "ADJUSTMENT"] as const;
export const ADJUSTMENT_KINDS = ["CREDIT", "DEBIT"] as const;
export const ADJUSTMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type BillingPeriodStatus = (typeof BILLING_PERIOD_STATUSES)[number];
export type ReadingType = (typeof READING_TYPES)[number];
export type ReadingFlag = (typeof READING_FLAGS)[number];
export type ReadingStatus = (typeof READING_STATUSES)[number];
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillLineKind = (typeof BILL_LINE_KINDS)[number];
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/** A monthly billing cycle of one zone. */
export const waterBillingPeriods = pgTable(
  "water_billing_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** YYYY-MM */
    period: text("period").notNull(),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => waterZones.id),
    readingFrom: date("reading_from", { mode: "string" }).notNull(),
    readingTo: date("reading_to", { mode: "string" }).notNull(),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").$type<BillingPeriodStatus>().notNull().default("OPEN"),
    ...createdColumns(),
  },
  (t) => [
    unique("water_periods_period_zone_uq").on(t.period, t.zoneId),
    check("water_periods_status_chk", inList("status", BILLING_PERIOD_STATUSES)),
    check("water_periods_period_chk", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("water_periods_dates_chk", sql`${t.readingFrom} <= ${t.readingTo} AND ${t.readingTo} <= ${t.billDate} AND ${t.billDate} <= ${t.dueDate}`),
  ],
);

/**
 * One reading per (period, account). ESTIMATED readings have no present reading; the next
 * actual reading subtracts the estimated m³ already billed. Readings are not financial rows:
 * one that hasn't been billed can be re-entered.
 */
export const waterReadings = pgTable(
  "water_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => waterBillingPeriods.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => waterMeters.id),
    previousReading: integer("previous_reading").notNull(),
    presentReading: integer("present_reading"),
    consumption: integer("consumption").notNull(),
    type: text("type").$type<ReadingType>().notNull(),
    rollover: boolean("rollover").notNull().default(false),
    flags: text("flags").array().$type<ReadingFlag[]>().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<ReadingStatus>().notNull(),
    readerId: uuid("reader_id").references(() => users.id),
    readAt: tstz("read_at").notNull(),
    clientUuid: uuid("client_uuid").unique(),
    photoUrl: text("photo_url"),
    remarks: text("remarks"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    ...createdColumns(),
  },
  (t) => [
    unique("water_readings_period_account_uq").on(t.periodId, t.accountId),
    check("water_readings_type_chk", inList("type", READING_TYPES)),
    check("water_readings_status_chk", inList("status", READING_STATUSES)),
    check("water_readings_values_chk", sql`${t.previousReading} >= 0 AND ${t.consumption} >= 0 AND (${t.presentReading} IS NULL OR ${t.presentReading} >= 0)`),
    check("water_readings_present_chk", sql`(${t.type} = 'ESTIMATED') = (${t.presentReading} IS NULL)`),
    index("water_readings_account_idx").on(t.accountId),
  ],
);

/** An ACTIVE account left out of one period's billing run, with the reason and its approver. */
export const waterBillingExclusions = pgTable(
  "water_billing_exclusions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => waterBillingPeriods.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    ...createdColumns(),
  },
  (t) => [unique("water_exclusions_period_account_uq").on(t.periodId, t.accountId)],
);

/** Posted bills. Never edited after posting: corrections are approved credit/debit memos. */
export const waterBills = pgTable(
  "water_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billNo: text("bill_no").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => waterCustomers.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => waterBillingPeriods.id),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => waterReadings.id),
    customerType: text("customer_type").$type<CustomerType>().notNull(),
    classification: text("classification").$type<Classification>().notNull(),
    consumption: integer("consumption").notNull(),
    basicCharge: money("basic_charge").notNull(),
    seniorDiscount: money("senior_discount").notNull(),
    otherCharges: money("other_charges").notNull(),
    advanceApplied: money("advance_applied").notNull(),
    /** basic − senior discount + other charges (before advances). */
    currentAmount: money("current_amount").notNull(),
    /** Unpaid balance of earlier bills, shown on the bill only (memo, never re-posted). */
    previousBalance: money("previous_balance").notNull(),
    totalAmountDue: money("total_amount_due").notNull(),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").$type<BillStatus>().notNull().default("UNPAID"),
    isFinal: boolean("is_final").notNull().default(false),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    unique("water_bills_period_account_uq").on(t.periodId, t.accountId),
    check("water_bills_status_chk", inList("status", BILL_STATUSES)),
    check("water_bills_customer_type_chk", inList("customer_type", CUSTOMER_TYPES)),
    check(
      "water_bills_amounts_chk",
      sql`${t.basicCharge} >= 0 AND ${t.seniorDiscount} >= 0 AND ${t.otherCharges} >= 0 AND ${t.advanceApplied} >= 0 AND ${t.previousBalance} >= 0 AND ${t.currentAmount} = ${t.basicCharge} - ${t.seniorDiscount} + ${t.otherCharges} AND ${t.advanceApplied} <= ${t.currentAmount} AND ${t.totalAmountDue} = ${t.currentAmount} - ${t.advanceApplied} + ${t.previousBalance}`,
    ),
    index("water_bills_account_idx").on(t.accountId),
  ],
);

/** Itemized bill lines; discounts and advances are negative amounts. */
export const waterBillLines = pgTable(
  "water_bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => waterBills.id),
    lineNo: integer("line_no").notNull(),
    kind: text("kind").$type<BillLineKind>().notNull(),
    description: text("description").notNull(),
    qty: integer("qty"),
    rate: money("rate"),
    amount: money("amount").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("water_bill_lines_no_uq").on(t.billId, t.lineNo), check("water_bill_lines_kind_chk", inList("kind", BILL_LINE_KINDS))],
);

/** Credit/debit memos on a posted bill; posted only when approved by someone other than the preparer. */
export const waterBillAdjustments = pgTable(
  "water_bill_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => waterBills.id),
    kind: text("kind").$type<AdjustmentKind>().notNull(),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<AdjustmentStatus>().notNull().default("PENDING"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tstz("approved_at"),
    rejectedReason: text("rejected_reason"),
    jeId: uuid("je_id").references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [
    check("water_adjustments_kind_chk", inList("kind", ADJUSTMENT_KINDS)),
    check("water_adjustments_status_chk", inList("status", ADJUSTMENT_STATUSES)),
    check("water_adjustments_amount_chk", sql`${t.amount} > 0`),
    check("water_adjustments_posted_chk", sql`(${t.status} = 'APPROVED') = (${t.jeId} IS NOT NULL)`),
    index("water_adjustments_bill_idx").on(t.billId),
  ],
);

export type BillingPeriod = typeof waterBillingPeriods.$inferSelect;
export type WaterReading = typeof waterReadings.$inferSelect;
export type WaterBill = typeof waterBills.$inferSelect;
export type WaterBillLine = typeof waterBillLines.$inferSelect;
export type WaterBillAdjustment = typeof waterBillAdjustments.$inferSelect;

// ── Collections, penalties, disconnection (Phase 07) ────────────────────────────────────────

export const DISCONNECTION_STATUSES = ["NOTICED", "DISCONNECTED", "RECONNECTED", "CANCELLED"] as const;
export type DisconnectionStatus = (typeof DISCONNECTION_STATUSES)[number];

/** Account closure settlement: the meter deposit offsets unpaid bills; the rest is refunded by DV. */
export const waterDepositSettlements = pgTable(
  "water_deposit_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => waterAccounts.id),
    deposit: money("deposit").notNull(),
    unpaid: money("unpaid").notNull(),
    offset: money("offset").notNull(),
    refund: money("refund").notNull(),
    /** Dr Customers' Deposits / Cr AR–Water for the offset (null when nothing was unpaid). */
    offsetJeId: uuid("offset_je_id").references(() => journalEntries.id),
    /** The DV that pays out the refund (null when nothing is left to refund). */
    dvId: uuid("dv_id").references(() => disbursementVouchers.id),
    ...createdColumns(),
  },
  (t) => [check("water_settlements_amounts_chk", sql`${t.offset} = LEAST(${t.deposit}, ${t.unpaid}) AND ${t.refund} = ${t.deposit} - ${t.offset}`)],
);

/**
 * How each payment was applied: oldest bill first, and within a bill the penalty first. A row
 * comes from a receipt item (teller payment) or from a deposit settlement (offset at closure).
 */
export const waterPaymentAllocations = pgTable(
  "water_payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptItemId: uuid("receipt_item_id").references(() => receiptItems.id),
    settlementId: uuid("settlement_id").references(() => waterDepositSettlements.id),
    billId: uuid("bill_id")
      .notNull()
      .references(() => waterBills.id),
    penaltyPart: money("penalty_part").notNull(),
    billPart: money("bill_part").notNull(),
    ...createdColumns(),
  },
  (t) => [
    check("water_allocations_source_chk", sql`(${t.receiptItemId} IS NULL) <> (${t.settlementId} IS NULL)`),
    check("water_allocations_amounts_chk", sql`${t.penaltyPart} >= 0 AND ${t.billPart} >= 0 AND ${t.penaltyPart} + ${t.billPart} > 0`),
    index("water_allocations_bill_idx").on(t.billId),
  ],
);

/** Late-payment penalty: once per bill, assessed the day after the due date. */
export const waterPenalties = pgTable(
  "water_penalties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .unique()
      .references(() => waterBills.id),
    assessedOn: date("assessed_on", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id),
    ...createdColumns(),
  },
  (t) => [check("water_penalties_amount_chk", sql`${t.amount} > 0`)],
);

/** Overpayments kept as advance credits (Cr Customers' Advances); billing runs apply them. */
export const waterCustomerAdvances = pgTable(
  "water_customer_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => waterCustomers.id),
    amount: money("amount").notNull(),
    sourceReceiptItemId: uuid("source_receipt_item_id")
      .notNull()
      .references(() => receiptItems.id),
    appliedBillId: uuid("applied_bill_id").references(() => waterBills.id),
    ...createdColumns(),
  },
  (t) => [check("water_advances_amount_chk", sql`${t.amount} > 0`), index("water_advances_customer_idx").on(t.customerId)],
);

/** Disconnection cycle: notice → disconnection order (with reading) → reconnection order. */
export const waterDisconnections = pgTable(
  "water_disconnections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => waterAccounts.id),
    noticeNo: text("notice_no").notNull().unique(),
    noticeDate: date("notice_date", { mode: "string" }).notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    /** Unpaid amount and bills when the notice was issued (printed on the notice). */
    noticeAmount: money("notice_amount").notNull(),
    noticeBills: integer("notice_bills").notNull(),
    disconnectedAt: date("disconnected_at", { mode: "string" }),
    disconnectReading: integer("disconnect_reading"),
    disconnectedBy: uuid("disconnected_by").references(() => users.id),
    reconnectedAt: date("reconnected_at", { mode: "string" }),
    reconnectReading: integer("reconnect_reading"),
    reconnectedBy: uuid("reconnected_by").references(() => users.id),
    /** The paid reconnection-fee receipt item used for this reconnection (each fee is used once). */
    feeReceiptItemId: uuid("fee_receipt_item_id")
      .unique()
      .references(() => receiptItems.id),
    status: text("status").$type<DisconnectionStatus>().notNull().default("NOTICED"),
    cancelReason: text("cancel_reason"),
    by: uuid("by").references(() => users.id),
    ...createdColumns(),
  },
  (t) => [
    check("water_disconnections_status_chk", inList("status", DISCONNECTION_STATUSES)),
    uniqueIndex("water_disconnections_open_uq").on(t.accountId).where(sql`${t.status} IN ('NOTICED', 'DISCONNECTED')`),
  ],
);

/** Production (source/bulk) meter readings, for non-revenue water (optional). */
export const waterProductionReadings = pgTable(
  "water_production_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    readingDate: date("reading_date", { mode: "string" }).notNull(),
    reading: bigint("reading", { mode: "number" }).notNull(),
    ...createdColumns(),
  },
  (t) => [unique("water_production_source_date_uq").on(t.source, t.readingDate), check("water_production_reading_chk", sql`${t.reading} >= 0`)],
);

export type WaterPenalty = typeof waterPenalties.$inferSelect;
export type WaterDisconnection = typeof waterDisconnections.$inferSelect;
export type WaterPaymentAllocation = typeof waterPaymentAllocations.$inferSelect;
