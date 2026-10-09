import type { SettingKey } from "./registry";

/**
 * How each coop setting is shown to the people who manage it (non-technical staff): a plain
 * label, a sentence of help, and the kind of field to edit it with. The stored values and their
 * validation stay in registry.ts; this file is only about wording and form fields.
 */

export type Choice = Record<string, string>;

export type FieldSpec =
  | { type: "text"; placeholder?: string }
  | { type: "money" }
  | { type: "percent"; suffix?: string }
  | { type: "number"; unit?: string; min?: number; max?: number; blankLabel?: string }
  /** A decimal multiplier stored as text, e.g. "2.0" = 2 times. */
  | { type: "times" }
  | { type: "yesno"; yes?: string; no?: string }
  | { type: "choice"; options: Choice }
  | { type: "month" }
  /** The same three items in an order the person picks. */
  | { type: "sequence"; items: Choice }
  | { type: "form"; fields: Array<{ key: string; label: string; spec: FieldSpec; help?: string }> }
  | { type: "list"; columns: Array<{ key: string; label: string; spec: FieldSpec }>; addLabel: string; newRow: Record<string, unknown> }
  /** A fixed set of names, each with a value (blank = not set). */
  | { type: "map"; valueSpec: FieldSpec; blankLabel: string }
  /** Income accounts the teller may post to (options come from the chart of accounts). */
  | { type: "incomeAccount" }
  /** An internal short code; made from another column of the row when left blank, and not shown. */
  | { type: "code"; from: string };

export type Presentation = {
  label: string;
  help: string;
  spec: FieldSpec;
  /** Shown instead of an Edit button: why this can't be changed here (and where it can). */
  readonly?: { reason: string; link?: { href: string; label: string } };
};

export const GROUP_HELP: Record<string, string> = {
  "Coop profile": "The cooperative's name and registration details, printed on receipts, bills and reports.",
  Security: "Sign-in rules for staff accounts.",
  "Members & share capital": "Membership fee and share capital rules.",
  "Savings & time deposits": "Interest and balance rules for savings and time deposits.",
  Loans: "Loan interest, penalties, approval limits and aging.",
  Water: "Water billing: due dates, fees, penalties, disconnection, reading flags, discounts and printing.",
  Store: "Coop store rules.",
  "Net surplus": "How the year's net surplus is divided (RA 9520 limits are checked).",
  Cashiering: "Teller counter rules.",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_NAMES = MONTHS;

const fixedPolicy = (reason: string) => ({ reason });
const numberFormatReadonly = {
  reason: "The numbering style is fixed so all numbers stay consistent. Ask the system administrator if it must change.",
};

export const PRESENTATION: Record<SettingKey, Presentation> = {
  // ── Coop profile ──
  "coop.name": { label: "Cooperative name", help: "The full registered name, printed on receipts, bills and reports.", spec: { type: "text" } },
  "coop.short_name": { label: "Short name", help: "Used where space is tight, e.g. on bills.", spec: { type: "text" } },
  "coop.address": { label: "Official address", help: "The registered office address.", spec: { type: "text" } },
  "coop.cda_reg_no": { label: "CDA registration no.", help: "From the CDA Certificate of Registration.", spec: { type: "text" } },
  "coop.tin": { label: "TIN", help: "The cooperative's BIR Tax Identification Number.", spec: { type: "text", placeholder: "000-000-000-000" } },
  "fiscal.year_start_month": { label: "Fiscal year starts in", help: "The first month of the cooperative's financial year.", spec: { type: "month" } },
  "tz.business": { label: "Time zone", help: "All dates and cut-offs use Philippine time.", spec: { type: "text" }, readonly: fixedPolicy("Fixed to Philippine time.") },

  // ── Security ──
  "auth.min_password_length": { label: "Minimum password length", help: "Staff passwords must have at least this many characters.", spec: { type: "number", unit: "characters", min: 10, max: 128 } },
  "auth.max_failed_logins": { label: "Wrong passwords before the account locks", help: "After this many wrong passwords in a row, the account is locked for a while.", spec: { type: "number", unit: "tries", min: 1, max: 20 } },
  "auth.lockout_minutes": { label: "Lock time", help: "How long a locked account must wait before trying again.", spec: { type: "number", unit: "minutes", min: 1, max: 1440 } },

  // ── Members & share capital ──
  "member.no_format": { label: "Member number style", help: "How member numbers look.", spec: { type: "text" }, readonly: numberFormatReadonly },
  "member.fee": { label: "Membership fee", help: "Paid once by a new member; not refundable.", spec: { type: "money" } },
  "share.par_value": { label: "Price per share (par value)", help: "The value of one share of capital.", spec: { type: "money" } },
  "share.min_subscription_shares": { label: "Minimum shares to subscribe", help: "The fewest shares a new member must subscribe to.", spec: { type: "number", unit: "shares", min: 1 } },
  "share.min_paid_up_regular": { label: "Minimum paid-up capital (regular member)", help: "How much a regular member must have paid on their shares.", spec: { type: "money" } },
  "share.max_holding_pct": { label: "Most one member may own", help: "No member may own more than this share of the total paid-up capital (law: at most 10%).", spec: { type: "percent", suffix: "of total paid-up capital" } },
  "share.auto_subscribe_excess": {
    label: "Extra share payments",
    help: "When a member pays more than their unpaid subscription.",
    spec: { type: "yesno", yes: "Subscribe more shares automatically", no: "Keep the extra as a separate amount" },
  },
  "share.asm_basis": { label: "Average share months (for interest on capital)", help: "Computed from each month-end paid-up balance over the year, divided by 12.", spec: { type: "text" }, readonly: fixedPolicy("Fixed method.") },

  // ── Savings & time deposits ──
  "savings.regular.rate_pa": { label: "Regular savings interest", help: "Yearly interest rate on regular savings.", spec: { type: "percent", suffix: "per year" } },
  "savings.interest_basis": { label: "How savings interest is computed", help: "On the average daily balance, actual days over 365.", spec: { type: "text" }, readonly: fixedPolicy("Fixed method.") },
  "savings.crediting": { label: "When savings interest is credited", help: "Every quarter: end of March, June, September and December.", spec: { type: "text" }, readonly: fixedPolicy("Fixed schedule.") },
  "savings.min_balance_earn": { label: "Minimum balance to earn interest", help: "Accounts whose average daily balance is below this earn no interest.", spec: { type: "money" } },
  "savings.maintaining_balance": { label: "Maintaining balance", help: "The least a savings account should keep.", spec: { type: "money" } },
  "savings.dormant_after_months": { label: "Account becomes dormant after", help: "An account with no deposits or withdrawals for this long is marked dormant.", spec: { type: "number", unit: "months", min: 1, max: 120 } },
  "savings.wtax_rate": { label: "Withholding tax on deposit interest", help: "Leave at 0% if the cooperative is exempt.", spec: { type: "percent" } },
  "td.pretermination_rate": { label: "Time deposit withdrawn early", help: "Earns only the regular savings rate for the days it was held.", spec: { type: "text" }, readonly: fixedPolicy("Fixed rule.") },

  // ── Loans ──
  "loan.interest_recognition": {
    label: "When loan interest is recorded as income",
    help: "Choose when the bookkeeping recognizes loan interest.",
    spec: { type: "choice", options: { ON_COLLECTION: "When the interest is collected", MONTHLY_ACCRUAL: "Every month as it is earned" } },
  },
  "loan.payment_allocation": {
    label: "How loan payments are applied",
    help: "The order each payment is applied in, starting with the oldest installment.",
    spec: {
      type: "form",
      fields: [
        { key: "order", label: "Apply payments to", spec: { type: "sequence", items: { PENALTY: "Penalty", INTEREST: "Interest", PRINCIPAL: "Principal" } } },
        { key: "installments", label: "Installments", spec: { type: "choice", options: { OLDEST_FIRST: "Oldest installment first" } } },
      ],
    },
  },
  "loan.excess_payment": { label: "Loan payments above what is due", help: "Paid ahead on the next installments (interest first, then principal); the schedule stays the same.", spec: { type: "text" }, readonly: fixedPolicy("Fixed rule.") },
  "loan.penalty_rate_pm": {
    label: "Penalty on late loan payments",
    help: "Charged on overdue installments.",
    spec: {
      type: "form",
      fields: [
        { key: "ratePerMonth", label: "Penalty rate", spec: { type: "percent", suffix: "per month" } },
        { key: "method", label: "Computed as", spec: { type: "choice", options: { SIMPLE: "Simple interest" } } },
        { key: "prorateDaysPerMonth", label: "Days counted in a month", spec: { type: "number", unit: "days", min: 1, max: 31 }, help: "For partial months." },
      ],
    },
  },
  "loan.grace_days": { label: "Grace period for loan payments", help: "No penalty if paid within this many days after the due date.", spec: { type: "number", unit: "days", min: 0, max: 60 } },
  "loan.par_threshold_days": { label: "Portfolio-at-risk counts loans late by", help: "Loans this many days or more past due count as “at risk”.", spec: { type: "number", unit: "days", min: 1, max: 365 } },
  "loan.manager_approval_limit": { label: "Manager can approve loans up to", help: "Larger loans go to the Credit Committee.", spec: { type: "money" } },
  "loan.block_if_past_due": {
    label: "New loans for members with late payments",
    help: "Whether a new loan is refused when the borrower or co-maker has an overdue loan.",
    spec: { type: "yesno", yes: "Refuse the new loan", no: "Allow the new loan" },
  },
  "loan.aging_buckets": {
    label: "Loan aging groups",
    help: "How overdue loans are grouped in the aging report, by days past due. Leave “to” blank on the last group.",
    spec: {
      type: "list",
      columns: [
        { key: "label", label: "Group name", spec: { type: "text" } },
        { key: "fromDays", label: "From (days)", spec: { type: "number", min: 0 } },
        { key: "toDays", label: "To (days)", spec: { type: "number", min: 0, blankLabel: "and over" } },
      ],
      addLabel: "Add group",
      newRow: { label: "", fromDays: 0, toDays: null },
    },
  },
  "loan.allowance_rates": {
    label: "Allowance for loan losses per aging group",
    help: "Set by the bookkeeper following CDA/auditor guidance. Leave blank if not yet decided.",
    spec: { type: "map", valueSpec: { type: "percent" }, blankLabel: "not set" },
  },

  // ── Water ──
  "water.customer_no_format": { label: "Water customer number style", help: "How customer numbers look.", spec: { type: "text" }, readonly: numberFormatReadonly },
  "water.account_no_format": { label: "Water account number style", help: "How service account numbers look.", spec: { type: "text" }, readonly: numberFormatReadonly },
  "water.billing_cycle": { label: "Billing cycle", help: "Each zone is billed once a month.", spec: { type: "text" }, readonly: fixedPolicy("Fixed: monthly per zone.") },
  "water.due_days": { label: "Bills are due", help: "Number of days after the bill date before a bill is due.", spec: { type: "number", unit: "days after the bill date", min: 1, max: 90 } },
  "water.tariff.RESIDENTIAL": {
    label: "Starting residential rates",
    help: "Only used when the system was first set up.",
    spec: { type: "text" },
    readonly: { reason: "Water rates are set on the Tariffs & fees page.", link: { href: "/water/tariffs", label: "Open Tariffs & fees" } },
  },
  "water.tariff.COMMERCIAL": {
    label: "Starting commercial rates",
    help: "Only used when the system was first set up.",
    spec: { type: "text" },
    readonly: { reason: "Water rates are set on the Tariffs & fees page.", link: { href: "/water/tariffs", label: "Open Tariffs & fees" } },
  },
  "water.member_rate_difference": {
    label: "Member and non-member rates",
    help: "Members can have their own rates (for example a lower minimum).",
    spec: { type: "text" },
    readonly: { reason: "Add a “members only” version on the Tariffs & fees page.", link: { href: "/water/tariffs", label: "Open Tariffs & fees" } },
  },
  "water.fee.connection": { label: "Connection fee", help: "Collected at the teller before the meter is installed.", spec: { type: "money" } },
  "water.fee.meter_deposit": { label: "Meter deposit", help: "Refundable when the account is closed, less any unpaid bills.", spec: { type: "money" } },
  "water.fee.reconnection": { label: "Reconnection fee", help: "Paid before a disconnected account is reconnected.", spec: { type: "money" } },
  "water.penalty_pct": { label: "Late payment penalty", help: "Added once to a bill still unpaid after its due date.", spec: { type: "percent", suffix: "of the unpaid bill" } },
  "water.disconnect_after_bills": { label: "Disconnection list after", help: "Accounts with this many unpaid bills get a disconnection notice.", spec: { type: "number", unit: "unpaid bills", min: 1, max: 24 } },
  "water.notice_days": { label: "Days to pay after a disconnection notice", help: "The customer has this many days to pay before the water is cut.", spec: { type: "number", unit: "days", min: 0, max: 90 } },
  "water.high_factor": {
    label: "Flag high water use",
    help: "Readings much higher than usual are held for review before billing.",
    spec: {
      type: "form",
      fields: [
        { key: "factor", label: "Flag when usage is more than", spec: { type: "times" }, help: "the 3-month average" },
        { key: "minM3", label: "and more than", spec: { type: "number", unit: "m³", min: 0 } },
      ],
    },
  },
  "water.low_flag": {
    label: "Flag low or zero water use",
    help: "Readings much lower than usual are held for review. The minimum charge is still billed.",
    spec: {
      type: "form",
      fields: [
        { key: "factor", label: "Flag when usage is below", spec: { type: "percent", suffix: "of the 3-month average" } },
        { key: "zero", label: "Zero usage", spec: { type: "yesno", yes: "Hold for review", no: "Bill without review" } },
      ],
    },
  },
  "water.estimate_basis": {
    label: "Suggested estimate",
    help: "When a meter can't be read, the clerk enters the estimate; this average is shown as a guide.",
    spec: {
      type: "form",
      fields: [
        { key: "months", label: "Average of the last", spec: { type: "number", unit: "months read", min: 1, max: 12 } },
        { key: "method", label: "Based on", spec: { type: "choice", options: { AVERAGE_LAST_ACTUAL: "Actual readings only" } } },
      ],
    },
  },
  "water.senior_discount": {
    label: "Senior-citizen discount (RA 9994)",
    help: "For residential accounts with a registered senior citizen.",
    spec: {
      type: "form",
      fields: [
        { key: "enabled", label: "Give the discount", spec: { type: "yesno" } },
        { key: "rate", label: "Discount", spec: { type: "percent", suffix: "of the basic charge" } },
        { key: "maxM3", label: "Only when usage is at most", spec: { type: "number", unit: "m³", min: 0 } },
        { key: "appliesTo", label: "Applies to", spec: { type: "choice", options: { BASIC_CHARGE: "The basic water charge" } } },
      ],
    },
  },
  "water.reading_schedule": {
    label: "Reading and billing days",
    help: "Filled in automatically when a new billing period is opened. Use 31 for the last day of the month.",
    spec: {
      type: "form",
      fields: [
        { key: "readingStartDay", label: "Meter reading starts on day", spec: { type: "number", min: 1, max: 31 } },
        { key: "readingEndDay", label: "Meter reading ends on day", spec: { type: "number", min: 1, max: 31 } },
        { key: "billDay", label: "Bills are dated on day", spec: { type: "number", min: 1, max: 31 } },
      ],
    },
  },
  "water.bill_paper": {
    label: "Bill paper size",
    help: "How bills are laid out when printed.",
    spec: {
      type: "choice",
      options: {
        QUARTER_SHORT: "¼ of short bond (4 bills per sheet)",
        QUARTER_LONG: "¼ of long bond (4 bills per sheet)",
        HALF_SHORT: "½ of short bond, lengthwise (2 bills per sheet)",
        HALF_LONG: "½ of long bond, lengthwise (2 bills per sheet)",
      },
    },
  },
  "water.overpayment": { label: "Water payments above what is owed", help: "Kept as an advance and used on the next bill.", spec: { type: "text" }, readonly: fixedPolicy("Fixed rule.") },
  "water.bill_disconnected_accounts": {
    label: "Disconnected accounts",
    help: "Whether disconnected accounts still get a monthly bill.",
    spec: { type: "yesno", yes: "Still bill them", no: "Don't bill them" },
  },

  // ── Store ──
  "store.cost_method": { label: "Store cost method", help: "Item costs are averaged each time stock is received.", spec: { type: "text" }, readonly: fixedPolicy("Fixed method.") },
  "store.allow_negative_stock": { label: "Selling more than the stock on hand", help: "Not allowed: the count must be corrected first.", spec: { type: "text" }, readonly: fixedPolicy("Always refused.") },
  "store.member_credit_limit": { label: "Store credit limit per member", help: "The most a member may owe the store at any time.", spec: { type: "money" } },

  // ── Net surplus ──
  "surplus.reserve_pct": { label: "Reserve fund", help: "Share of net surplus set aside first (law: at least 10%).", spec: { type: "percent", suffix: "of net surplus" } },
  "surplus.etf_pct": { label: "Education & training fund", help: "Law: at most 10%; half goes to the CETF.", spec: { type: "percent", suffix: "of net surplus" } },
  "surplus.cdf_pct": { label: "Community development fund", help: "Law: at least 3%.", spec: { type: "percent", suffix: "of net surplus" } },
  "surplus.optional_pct": { label: "Optional fund", help: "Law: at most 7%.", spec: { type: "percent", suffix: "of net surplus" } },
  "surplus.isc_share_of_remaining": { label: "Interest on share capital", help: "Share of what remains after the funds, as approved by the General Assembly.", spec: { type: "percent", suffix: "of the remainder" } },
  "surplus.pr_share_of_remaining": { label: "Patronage refund", help: "Share of what remains after the funds (law: at least 30%).", spec: { type: "percent", suffix: "of the remainder" } },
  "surplus.pr_basis": {
    label: "Patronage refund is based on",
    help: "What members' business with the coop counts toward their refund. Non-members never get a refund.",
    spec: {
      type: "form",
      fields: [
        { key: "loanInterestPaid", label: "Loan interest paid", spec: { type: "yesno", yes: "Counts", no: "Doesn't count" } },
        { key: "netStorePurchases", label: "Store purchases", spec: { type: "yesno", yes: "Counts", no: "Doesn't count" } },
        { key: "waterBillsPaidByMembers", label: "Water bills paid", spec: { type: "yesno", yes: "Counts", no: "Doesn't count" } },
      ],
    },
  },
  "surplus.offset_arrears_first": {
    label: "Unpaid balances when paying ISC/patronage refund",
    help: "Whether a member's overdue amounts are deducted first.",
    spec: { type: "yesno", yes: "Deduct them first", no: "Pay in full" },
  },
  "surplus.isc_pr_wtax_rate": { label: "Withholding tax on ISC and patronage refund", help: "Leave at 0% if exempt.", spec: { type: "percent" } },

  // ── Cashiering ──
  "cash.require_bir_receipt_no": {
    label: "BIR receipt number on every receipt",
    help: "Until BIR approves system-printed receipts, the teller types the number of the BIR-registered receipt issued.",
    spec: { type: "yesno", yes: "Required", no: "Optional" },
  },
  "cash.other_income_items": {
    label: "Other income the teller can collect",
    help: "Items like certification fees or hall rental, each posted to its income account.",
    spec: {
      type: "list",
      columns: [
        { key: "label", label: "Item name", spec: { type: "text" } },
        { key: "mappingKey", label: "Income account", spec: { type: "incomeAccount" } },
        { key: "code", label: "Short code (optional)", spec: { type: "code", from: "label" } },
      ],
      addLabel: "Add item",
      newRow: { code: "", label: "", mappingKey: "" },
    },
  },
  "cash.denominations": {
    label: "Bills and coins in the cash count",
    help: "The denominations the teller counts when closing the drawer.",
    spec: {
      type: "list",
      columns: [
        { key: "value", label: "Value", spec: { type: "money" } },
        { key: "kind", label: "Bill or coin", spec: { type: "choice", options: { BILL: "Bill", COIN: "Coin" } } },
      ],
      addLabel: "Add denomination",
      newRow: { value: "0", kind: "BILL" },
    },
  },
  "cash.short_over_policy": { label: "Cash short or over", help: "Posted after the manager verifies the teller's count.", spec: { type: "text" }, readonly: fixedPolicy("Fixed rule.") },
};
