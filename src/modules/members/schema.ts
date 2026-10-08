import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";

export const MEMBER_TYPES = ["REGULAR", "ASSOCIATE"] as const;
export const MEMBER_STATUSES = ["APPLICANT", "ACTIVE", "INACTIVE", "TERMINATED", "DECEASED"] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberNo: text("member_no").unique(),
    type: text("type").$type<MemberType>().notNull(),
    status: text("status").$type<MemberStatus>().notNull().default("APPLICANT"),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    suffix: text("suffix"),
    /** normalized last|first, for the duplicate rule */
    nameKey: text("name_key").notNull(),
    /** normalized member no. + names, for search */
    searchText: text("search_text").notNull(),
    birthdate: date("birthdate", { mode: "string" }).notNull(),
    sex: text("sex").notNull(),
    civilStatus: text("civil_status").notNull(),
    addrStreet: text("addr_street"),
    addrPurok: text("addr_purok"),
    addrBarangay: text("addr_barangay").notNull(),
    addrMunicipality: text("addr_municipality").notNull(),
    addrProvince: text("addr_province").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    occupation: text("occupation"),
    employer: text("employer"),
    tin: text("tin"),
    validIdType: text("valid_id_type"),
    validIdNo: text("valid_id_no"),
    pmesDate: date("pmes_date", { mode: "string" }),
    bodResolutionNo: text("bod_resolution_no"),
    approvedAt: tstz("approved_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    membershipDate: date("membership_date", { mode: "string" }),
    privacyConsentAt: tstz("privacy_consent_at"),
    remarks: text("remarks"),
    ...createdColumns(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("members_dup_idx").on(t.nameKey, t.birthdate),
    index("members_status_idx").on(t.status),
    check("members_type_chk", inList("type", MEMBER_TYPES)),
    check("members_status_chk", inList("status", MEMBER_STATUSES)),
    check("members_no_iff_approved", sql`(${t.status} = 'APPLICANT') = (${t.memberNo} IS NULL)`),
  ],
);

export const memberBeneficiaries = pgTable(
  "member_beneficiaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    birthdate: date("birthdate", { mode: "string" }),
    sharePct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
    ...createdColumns(),
  },
  (t) => [
    index("member_beneficiaries_member_idx").on(t.memberId),
    check("member_beneficiaries_pct_chk", sql`${t.sharePct} > 0 AND ${t.sharePct} <= 100`),
  ],
);

export const memberStatusHistory = pgTable(
  "member_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    fromStatus: text("from_status").$type<MemberStatus>().notNull(),
    toStatus: text("to_status").$type<MemberStatus>().notNull(),
    reason: text("reason").notNull(),
    ref: text("ref"),
    at: tstz("at").notNull(),
    by: uuid("by").references(() => users.id),
    ...createdColumns(),
  },
  (t) => [index("member_status_history_member_idx").on(t.memberId, t.at)],
);

export type Member = typeof members.$inferSelect;
export type Beneficiary = typeof memberBeneficiaries.$inferSelect;
