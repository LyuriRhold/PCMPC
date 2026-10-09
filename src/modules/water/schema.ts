import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, serial, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";
import { members } from "@/modules/members/schema";

export const CUSTOMER_TYPES = ["MEMBER", "NON_MEMBER"] as const;
export const CLASSIFICATIONS = ["RESIDENTIAL", "COMMERCIAL", "INSTITUTIONAL", "BULK"] as const;
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "DISCONNECTED", "CLOSED"] as const;
export const APPLICATION_STATUSES = ["APPLIED", "INSPECTED", "APPROVED", "INSTALLED", "REJECTED"] as const;
export const METER_STATUSES = ["IN_STOCK", "INSTALLED", "DEFECTIVE", "RETIRED"] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type MeterStatus = (typeof METER_STATUSES)[number];
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
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    minCharge: money("min_charge").notNull(),
    minCubic: integer("min_cubic").notNull(),
    blocks: jsonb("blocks").$type<RateBlock[]>().notNull(),
    nwrbRef: text("nwrb_ref").notNull(),
    approvedAt: tstz("approved_at"),
    ...createdColumns(),
  },
  (t) => [
    unique("water_rate_schedules_version_uq").on(t.classification, t.effectiveFrom),
    check("water_rate_schedules_class_chk", inList("classification", CLASSIFICATIONS)),
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
