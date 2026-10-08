import { z } from "zod";
import { isBusinessDate } from "@/lib/dates";

// Shared by the application form (client) and the server actions. Business rules (duplicates,
// approval requirements, status transitions) live in service.ts.

const text = (max: number) => z.string().trim().max(max);
/** Optional text: empty → null. */
const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const businessDate = z.string().refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)");
const optDate = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isBusinessDate(v), "Enter a valid date (YYYY-MM-DD)");

export const SEXES = ["MALE", "FEMALE"] as const;
export const CIVIL_STATUSES = ["SINGLE", "MARRIED", "WIDOWED", "SEPARATED", "ANNULLED"] as const;
/** Common Philippine IDs, offered as suggestions in the form (any text is accepted). */
export const ID_TYPES = [
  "PhilSys ID",
  "Driver's License",
  "Passport",
  "UMID",
  "SSS ID",
  "PRC ID",
  "Voter's ID",
  "Postal ID",
  "Senior Citizen ID",
  "Barangay ID",
] as const;

export const memberInputSchema = z.object({
  type: z.enum(["REGULAR", "ASSOCIATE"]),
  lastName: text(80).min(1, "Last name is required"),
  firstName: text(80).min(1, "First name is required"),
  middleName: optText(80),
  suffix: optText(10),
  birthdate: businessDate,
  sex: z.enum(SEXES),
  civilStatus: z.enum(CIVIL_STATUSES),
  addrStreet: optText(),
  addrPurok: optText(80),
  addrBarangay: text(80).min(1, "Barangay is required"),
  addrMunicipality: text(80).min(1, "Municipality is required"),
  addrProvince: text(80).min(1, "Province is required"),
  mobile: optText(20).refine((v) => v === null || /^[0-9+\-\s()]{7,20}$/.test(v), "Enter a valid mobile number"),
  email: optText(200).refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid e-mail"),
  occupation: optText(120),
  employer: optText(120),
  tin: optText(20),
  validIdType: optText(60),
  validIdNo: optText(40),
  pmesDate: optDate,
  bodResolutionNo: optText(40),
  privacyConsent: z.boolean().default(false),
  remarks: optText(500),
});

export type MemberInput = z.input<typeof memberInputSchema>;
export type MemberData = z.output<typeof memberInputSchema>;

export const approveSchema = z.object({
  memberId: z.uuid(),
  pmesDate: optDate,
  bodResolutionNo: optText(40),
  privacyConsent: z.boolean().optional(),
});

export const STATUS_TARGETS = ["ACTIVE", "INACTIVE", "TERMINATED", "DECEASED"] as const;

export const changeStatusSchema = z.object({
  memberId: z.uuid(),
  to: z.enum(STATUS_TARGETS),
  reason: text(300).min(1, "A reason is required"),
  ref: optText(80),
});

export const beneficiarySchema = z.object({
  name: text(120).min(1, "Beneficiary name is required"),
  relationship: text(40).min(1, "Relationship is required"),
  birthdate: optDate,
  /** Percent with up to 2 decimals, as text ("60", "33.33"). */
  sharePct: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Share must be a percent with up to 2 decimals"),
});

export const beneficiariesSchema = z.object({
  memberId: z.uuid(),
  beneficiaries: z.array(beneficiarySchema).max(20),
});

export type BeneficiaryInput = z.input<typeof beneficiarySchema>;

export const searchSchema = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["APPLICANT", "ACTIVE", "INACTIVE", "TERMINATED", "DECEASED"]).optional(),
  type: z.enum(["REGULAR", "ASSOCIATE"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

/** "60" → 6000 hundredths of a percent; exact, no floats. */
export function pctToHundredths(pct: string): number {
  const [whole = "0", frac = ""] = pct.trim().split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
