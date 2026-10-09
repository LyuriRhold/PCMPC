import { z } from "zod";

/**
 * Every configurable setting: its zod schema (the stored JSON shape), its default and whether
 * the default is still awaiting PCMPC confirmation. Defaults come from docs/DOMAIN.md §2 and the
 * phase specs. Storage conventions (JSON can't hold bigint):
 *   money → centavos as a decimal string ("50000" = ₱500.00)
 *   rate  → fraction as a decimal string ("0.02" = 2%)
 */

const money = z.string().regex(/^\d+$/, "amount must be non-negative centavos as an integer string");
const RATE_RE = /^\d+(\.\d+)?$/;
const rate = z.string().regex(RATE_RE, "rate must be a decimal string such as 0.02");
const rateBetween = (min: string, max: string) =>
  rate.refine((v) => !RATE_RE.test(v) || (cmp(v, min) >= 0 && cmp(v, max) <= 0), `must be between ${min} and ${max}`);
const int = (min: number, max = 1_000_000) => z.number().int().min(min).max(max);
const text = z.string().max(500);
const numberFormat = z.string().regex(/\{0+\}/, "format needs a {000…} counter");

/** Compares two non-negative decimal strings exactly. */
function cmp(a: string, b: string): number {
  const [ai = "0", af = ""] = a.split(".");
  const [bi = "0", bf = ""] = b.split(".");
  const len = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(len, "0"));
  const y = BigInt(bi + bf.padEnd(len, "0"));
  return x === y ? 0 : x > y ? 1 : -1;
}

const tariff = z.object({
  minimumCharge: money,
  minimumM3: int(0, 1000),
  blocks: z
    .array(z.object({ fromM3: int(0), toM3: int(0).nullable(), ratePerM3: money }))
    .min(1),
});

export type SettingKind = "money" | "rate" | "int" | "bool" | "text" | "enum" | "json";

type Def<S extends z.ZodType> = {
  group: string;
  label: string;
  kind: SettingKind;
  schema: S;
  default: z.input<S>;
  confirm: boolean;
  note?: string;
};

function def<S extends z.ZodType>(d: Def<S>): Def<S> {
  return d;
}

export const SETTINGS = {
  // Coop profile
  "coop.name": def({ group: "Coop profile", label: "Cooperative name", kind: "text", schema: text.min(1), default: "Pipindan Community Multi-Purpose Cooperative", confirm: false }),
  "coop.short_name": def({ group: "Coop profile", label: "Short name", kind: "text", schema: text.min(1), default: "PCMPC", confirm: false }),
  "coop.address": def({ group: "Coop profile", label: "Official address", kind: "text", schema: text, default: "Pipindan, Binangonan, Rizal", confirm: true, note: "full address" }),
  "coop.cda_reg_no": def({ group: "Coop profile", label: "CDA registration no.", kind: "text", schema: text, default: "", confirm: true }),
  "coop.tin": def({ group: "Coop profile", label: "TIN", kind: "text", schema: text, default: "", confirm: true }),
  "fiscal.year_start_month": def({ group: "Coop profile", label: "Fiscal year start month (1–12)", kind: "int", schema: int(1, 12), default: 1, confirm: true }),
  "tz.business": def({ group: "Coop profile", label: "Business time zone", kind: "text", schema: z.literal("Asia/Manila"), default: "Asia/Manila", confirm: false, note: "fixed; the app reads APP_TZ" }),

  // Security (PHASE-01 business rules)
  "auth.min_password_length": def({ group: "Security", label: "Minimum password length", kind: "int", schema: int(10, 128), default: 10, confirm: false }),
  "auth.max_failed_logins": def({ group: "Security", label: "Failed logins before lockout", kind: "int", schema: int(1, 20), default: 5, confirm: false }),
  "auth.lockout_minutes": def({ group: "Security", label: "Lockout duration (minutes)", kind: "int", schema: int(1, 1440), default: 15, confirm: false }),

  // Members & share capital
  "member.no_format": def({ group: "Members & share capital", label: "Member no. format", kind: "text", schema: numberFormat, default: "M-{000000}", confirm: true }),
  "member.fee": def({ group: "Members & share capital", label: "Membership fee", kind: "money", schema: money, default: "50000", confirm: true, note: "non-refundable income" }),
  "share.par_value": def({ group: "Members & share capital", label: "Par value per share", kind: "money", schema: money, default: "10000", confirm: true }),
  "share.min_subscription_shares": def({ group: "Members & share capital", label: "Minimum subscription (shares)", kind: "int", schema: int(1), default: 100, confirm: true }),
  "share.min_paid_up_regular": def({ group: "Members & share capital", label: "Minimum paid-up for a regular member", kind: "money", schema: money, default: "250000", confirm: true }),
  "share.max_holding_pct": def({ group: "Members & share capital", label: "Maximum holding (% of total paid-up)", kind: "rate", schema: rateBetween("0", "0.10"), default: "0.10", confirm: true, note: "RA 9520 limit" }),
  "share.auto_subscribe_excess": def({ group: "Members & share capital", label: "Auto-subscribe payments above the unpaid subscription", kind: "bool", schema: z.boolean(), default: false, confirm: true }),
  "share.asm_basis": def({ group: "Members & share capital", label: "ASM basis", kind: "enum", schema: z.enum(["MONTH_END_BALANCE"]), default: "MONTH_END_BALANCE", confirm: true, note: "Σ 12 month-end paid-up ÷ 12" }),

  // Savings & time deposits
  "savings.regular.rate_pa": def({ group: "Savings & time deposits", label: "Regular savings rate p.a.", kind: "rate", schema: rateBetween("0", "1"), default: "0.02", confirm: true }),
  "savings.interest_basis": def({ group: "Savings & time deposits", label: "Interest basis", kind: "enum", schema: z.enum(["ADB_ACTUAL_365"]), default: "ADB_ACTUAL_365", confirm: true }),
  "savings.crediting": def({ group: "Savings & time deposits", label: "Interest crediting", kind: "enum", schema: z.enum(["QUARTERLY"]), default: "QUARTERLY", confirm: true, note: "Mar/Jun/Sep/Dec end" }),
  "savings.min_balance_earn": def({ group: "Savings & time deposits", label: "Minimum ADB to earn interest", kind: "money", schema: money, default: "50000", confirm: true }),
  "savings.maintaining_balance": def({ group: "Savings & time deposits", label: "Maintaining balance", kind: "money", schema: money, default: "10000", confirm: true }),
  "savings.dormant_after_months": def({ group: "Savings & time deposits", label: "Dormant after (months)", kind: "int", schema: int(1, 120), default: 24, confirm: true }),
  "savings.wtax_rate": def({ group: "Savings & time deposits", label: "Withholding tax on deposit interest", kind: "rate", schema: rateBetween("0", "1"), default: "0", confirm: true }),
  "td.pretermination_rate": def({ group: "Savings & time deposits", label: "TD pre-termination rate", kind: "enum", schema: z.enum(["REGULAR_SAVINGS_RATE_FOR_DAYS_HELD"]), default: "REGULAR_SAVINGS_RATE_FOR_DAYS_HELD", confirm: true }),

  // Loans
  "loan.interest_recognition": def({ group: "Loans", label: "Interest recognition", kind: "enum", schema: z.enum(["ON_COLLECTION", "MONTHLY_ACCRUAL"]), default: "ON_COLLECTION", confirm: true }),
  "loan.payment_allocation": def({ group: "Loans", label: "Payment allocation", kind: "json", schema: z.object({ order: z.array(z.enum(["PENALTY", "INTEREST", "PRINCIPAL"])).length(3), installments: z.enum(["OLDEST_FIRST"]) }), default: { order: ["PENALTY", "INTEREST", "PRINCIPAL"], installments: "OLDEST_FIRST" }, confirm: true }),
  "loan.excess_payment": def({ group: "Loans", label: "Excess payment", kind: "enum", schema: z.enum(["ADVANCE_NEXT_INSTALLMENTS"]), default: "ADVANCE_NEXT_INSTALLMENTS", confirm: true, note: "interest then principal; schedule unchanged" }),
  "loan.penalty_rate_pm": def({ group: "Loans", label: "Penalty on overdue amortization", kind: "json", schema: z.object({ ratePerMonth: rate, method: z.enum(["SIMPLE"]), prorateDaysPerMonth: int(1, 31) }), default: { ratePerMonth: "0.02", method: "SIMPLE", prorateDaysPerMonth: 30 }, confirm: true }),
  "loan.grace_days": def({ group: "Loans", label: "Grace days", kind: "int", schema: int(0, 60), default: 3, confirm: true }),
  "loan.par_threshold_days": def({ group: "Loans", label: "PAR threshold (days)", kind: "int", schema: int(1, 365), default: 30, confirm: true }),
  "loan.manager_approval_limit": def({ group: "Loans", label: "Manager approval limit", kind: "money", schema: money, default: "3000000", confirm: true, note: "above → Credit Committee" }),
  "loan.block_if_past_due": def({ group: "Loans", label: "Block new loans if borrower or comaker is past due", kind: "bool", schema: z.boolean(), default: true, confirm: true }),
  "loan.aging_buckets": def({ group: "Loans", label: "Aging buckets (days past due)", kind: "json", schema: z.array(z.object({ label: text.min(1), fromDays: int(0), toDays: int(0).nullable() })).min(1), default: [{ label: "Current", fromDays: 0, toDays: 0 }, { label: "1–30", fromDays: 1, toDays: 30 }, { label: "31–90", fromDays: 31, toDays: 90 }, { label: "91–180", fromDays: 91, toDays: 180 }, { label: "181–365", fromDays: 181, toDays: 365 }, { label: ">365", fromDays: 366, toDays: null }], confirm: true }),
  "loan.allowance_rates": def({ group: "Loans", label: "Allowance rate per aging bucket", kind: "json", schema: z.record(z.string(), rate.nullable()), default: { Current: null, "1–30": null, "31–90": null, "91–180": null, "181–365": null, ">365": null }, confirm: true, note: "set by the bookkeeper per CDA/auditor guidance; null = not yet set" }),

  // Water
  "water.customer_no_format": def({ group: "Water", label: "Customer no. format", kind: "text", schema: numberFormat, default: "WC-{000000}", confirm: true }),
  "water.account_no_format": def({ group: "Water", label: "Account no. format", kind: "text", schema: numberFormat, default: "WA-{000000}", confirm: true }),
  "water.billing_cycle": def({ group: "Water", label: "Billing cycle", kind: "enum", schema: z.enum(["MONTHLY_PER_ZONE"]), default: "MONTHLY_PER_ZONE", confirm: true }),
  "water.due_days": def({ group: "Water", label: "Due date (days after bill date)", kind: "int", schema: int(1, 90), default: 15, confirm: true }),
  "water.tariff.RESIDENTIAL": def({ group: "Water", label: "Residential tariff", kind: "json", schema: tariff, default: { minimumCharge: "20000", minimumM3: 10, blocks: [{ fromM3: 11, toM3: 20, ratePerM3: "2500" }, { fromM3: 21, toM3: 30, ratePerM3: "3000" }, { fromM3: 31, toM3: null, ratePerM3: "3500" }] }, confirm: true, note: "must equal the NWRB-approved tariff" }),
  "water.tariff.COMMERCIAL": def({ group: "Water", label: "Commercial tariff", kind: "json", schema: tariff, default: { minimumCharge: "40000", minimumM3: 10, blocks: [{ fromM3: 11, toM3: null, ratePerM3: "4000" }] }, confirm: true, note: "must equal the NWRB-approved tariff" }),
  "water.member_rate_difference": def({ group: "Water", label: "Member vs non-member rate difference", kind: "enum", schema: z.enum(["NONE"]), default: "NONE", confirm: true }),
  "water.fee.connection": def({ group: "Water", label: "Connection fee", kind: "money", schema: money, default: "350000", confirm: true }),
  "water.fee.meter_deposit": def({ group: "Water", label: "Meter deposit", kind: "money", schema: money, default: "100000", confirm: true, note: "refundable, net of unpaid bills" }),
  "water.fee.reconnection": def({ group: "Water", label: "Reconnection fee", kind: "money", schema: money, default: "30000", confirm: true }),
  "water.penalty_pct": def({ group: "Water", label: "Late penalty (% of unpaid current bill)", kind: "rate", schema: rateBetween("0", "1"), default: "0.10", confirm: true, note: "once per bill, the day after due" }),
  "water.disconnect_after_bills": def({ group: "Water", label: "Disconnect after unpaid bills", kind: "int", schema: int(1, 24), default: 2, confirm: true }),
  "water.notice_days": def({ group: "Water", label: "Disconnection notice (days)", kind: "int", schema: int(0, 90), default: 7, confirm: true }),
  "water.high_factor": def({ group: "Water", label: "High-consumption flag", kind: "json", schema: z.object({ factor: rate, minM3: int(0) }), default: { factor: "2.0", minM3: 10 }, confirm: true, note: "factor × 3-month average and above minM3" }),
  "water.low_flag": def({ group: "Water", label: "Low / zero consumption flags", kind: "json", schema: z.object({ factor: rate, zero: z.boolean() }), default: { factor: "0.3", zero: true }, confirm: true, note: "LOW below factor × 3-month average; ZERO when nothing was used" }),
  "water.estimate_basis": def({ group: "Water", label: "Estimate basis", kind: "json", schema: z.object({ method: z.enum(["AVERAGE_LAST_ACTUAL"]), months: int(1, 12) }), default: { method: "AVERAGE_LAST_ACTUAL", months: 3 }, confirm: true }),
  "water.senior_discount": def({ group: "Water", label: "Senior-citizen discount (RA 9994)", kind: "json", schema: z.object({ enabled: z.boolean().default(true), rate: rateBetween("0", "1"), maxM3: int(0), appliesTo: z.enum(["BASIC_CHARGE"]) }), default: { enabled: true, rate: "0.05", maxM3: 30, appliesTo: "BASIC_CHARGE" }, confirm: true, note: "switch off if RA 9994 doesn't apply to the coop's water system" }),
  "water.reading_schedule": def({ group: "Water", label: "Reading and billing schedule (day of the month)", kind: "json", schema: z.object({ readingStartDay: int(1, 31), readingEndDay: int(1, 31), billDay: int(1, 31) }), default: { readingStartDay: 1, readingEndDay: 5, billDay: 7 }, confirm: false, note: "pre-fills each new billing period; a day past the month's end means its last day" }),
  "water.bill_paper": def({ group: "Water", label: "Bill paper size", kind: "enum", schema: z.enum(["QUARTER_SHORT", "QUARTER_LONG", "HALF_SHORT", "HALF_LONG"]), default: "QUARTER_SHORT", confirm: false, note: "¼ of short or long bond (4 bills per sheet), or ½ lengthwise (2 per sheet)" }),
  "water.overpayment": def({ group: "Water", label: "Overpayment", kind: "enum", schema: z.enum(["ADVANCE_CREDIT_NEXT_BILL"]), default: "ADVANCE_CREDIT_NEXT_BILL", confirm: true }),
  "water.bill_disconnected_accounts": def({ group: "Water", label: "Bill disconnected accounts", kind: "bool", schema: z.boolean(), default: false, confirm: true }),

  // Store
  "store.cost_method": def({ group: "Store", label: "Cost method", kind: "enum", schema: z.enum(["MOVING_AVERAGE"]), default: "MOVING_AVERAGE", confirm: false }),
  "store.allow_negative_stock": def({ group: "Store", label: "Allow negative stock", kind: "bool", schema: z.literal(false), default: false, confirm: false }),
  "store.member_credit_limit": def({ group: "Store", label: "Member credit limit", kind: "money", schema: money, default: "100000", confirm: true }),

  // Net surplus allocation (RA 9520 bounds)
  "surplus.reserve_pct": def({ group: "Net surplus", label: "Reserve fund", kind: "rate", schema: rateBetween("0.10", "1"), default: "0.10", confirm: true, note: "must be ≥ 10%" }),
  "surplus.etf_pct": def({ group: "Net surplus", label: "Education & training fund", kind: "rate", schema: rateBetween("0", "0.10"), default: "0.10", confirm: true, note: "must be ≤ 10%; half to CETF" }),
  "surplus.cdf_pct": def({ group: "Net surplus", label: "Community development fund", kind: "rate", schema: rateBetween("0.03", "1"), default: "0.03", confirm: true, note: "must be ≥ 3%" }),
  "surplus.optional_pct": def({ group: "Net surplus", label: "Optional fund", kind: "rate", schema: rateBetween("0", "0.07"), default: "0.07", confirm: true, note: "must be ≤ 7%" }),
  "surplus.isc_share_of_remaining": def({ group: "Net surplus", label: "ISC share of the remainder", kind: "rate", schema: rateBetween("0", "0.70"), default: "0.70", confirm: true, note: "GA-approved" }),
  "surplus.pr_share_of_remaining": def({ group: "Net surplus", label: "PR share of the remainder", kind: "rate", schema: rateBetween("0.30", "1"), default: "0.30", confirm: true, note: "must be ≥ 30%" }),
  "surplus.pr_basis": def({ group: "Net surplus", label: "Patronage refund basis", kind: "json", schema: z.object({ loanInterestPaid: z.boolean(), netStorePurchases: z.boolean(), waterBillsPaidByMembers: z.boolean() }), default: { loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: false }, confirm: true, note: "non-members never get PR" }),
  "surplus.offset_arrears_first": def({ group: "Net surplus", label: "Offset arrears before paying ISC/PR", kind: "bool", schema: z.boolean(), default: true, confirm: true }),
  "surplus.isc_pr_wtax_rate": def({ group: "Net surplus", label: "Withholding tax on ISC/PR", kind: "rate", schema: rateBetween("0", "1"), default: "0", confirm: true }),

  // Cashiering
  "cash.require_bir_receipt_no": def({ group: "Cashiering", label: "Require the BIR receipt no. on every receipt", kind: "bool", schema: z.boolean(), default: true, confirm: true, note: "PLAN R1: until BIR approves system-printed receipts" }),
  "cash.other_income_items": def({ group: "Cashiering", label: "Other income items the teller may collect", kind: "json", schema: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,30}$/), label: text.min(1), mappingKey: z.string().min(1) })).min(1), default: [{ code: "CERT_FEE", label: "Certification fee", mappingKey: "certification_fee_income" }, { code: "HALL_RENTAL", label: "Hall rental", mappingKey: "rental_income" }], confirm: true, note: "mappingKey = an account posting key" }),
  "cash.denominations": def({ group: "Cashiering", label: "Denominations for the cash count", kind: "json", schema: z.array(z.object({ value: money, kind: z.enum(["BILL", "COIN"]) })).min(1), default: [{ value: "100000", kind: "BILL" }, { value: "50000", kind: "BILL" }, { value: "20000", kind: "BILL" }, { value: "10000", kind: "BILL" }, { value: "5000", kind: "BILL" }, { value: "2000", kind: "BILL" }, { value: "2000", kind: "COIN" }, { value: "1000", kind: "COIN" }, { value: "500", kind: "COIN" }, { value: "100", kind: "COIN" }, { value: "25", kind: "COIN" }, { value: "5", kind: "COIN" }, { value: "1", kind: "COIN" }], confirm: true, note: "centavos" }),
  "cash.short_over_policy": def({ group: "Cashiering", label: "Cash short/over", kind: "enum", schema: z.enum(["POST_AFTER_MANAGER_VERIFICATION"]), default: "POST_AFTER_MANAGER_VERIFICATION", confirm: true }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]["schema"]>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
