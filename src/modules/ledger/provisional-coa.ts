import type { AccountType, NormalBalance } from "./schema";

/**
 * One row of a chart of accounts, as imported from docs/coa/pcmpc-coa.csv or taken from the
 * provisional list below. `mappingKeys` are DOMAIN §6 keys that point at this account.
 */
export type CoaRow = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  parentCode: string | null;
  isPostable: boolean;
  scaCode: string | null;
  mappingKeys: string[];
};

/** Keys whose lines form a member subsidiary ledger (each line must carry a member). Q-03.4. */
export const MEMBER_SUBSIDIARY_KEYS = [
  "subscribed_share_capital_common",
  "subscription_receivable_common",
  "savings_deposits",
  "time_deposits",
  "loans_receivable_REG",
  "loans_receivable_EMR",
  "loans_receivable_PRD",
  "accounts_receivable_members",
] as const;

/**
 * Every DOMAIN §6 mapping key the system posts to. Templated keys are expanded for the sample loan
 * products (REG, EMR, PRD; DOMAIN §2). `accumulated_depreciation_{class}` keys are added in
 * Phase 14 together with the fixed-asset classes.
 */
export const REQUIRED_MAPPING_KEYS = [
  "cash_on_hand",
  "cash_in_bank",
  "loans_receivable_REG",
  "loans_receivable_EMR",
  "loans_receivable_PRD",
  "accounts_receivable_members",
  "ar_water",
  "subscription_receivable_common",
  "allowance_probable_losses",
  "merchandise_inventory",
  "savings_deposits",
  "time_deposits",
  "accounts_payable_trade",
  "customers_deposits",
  "customers_advances",
  "lpp_insurance_payable",
  "withholding_tax_payable",
  "cetf_payable",
  "isc_payable",
  "patronage_refund_payable",
  "subscribed_share_capital_common",
  "undivided_net_surplus",
  "reserve_fund",
  "education_training_fund",
  "community_development_fund",
  "optional_fund",
  "interest_income_loans",
  "service_fee_income",
  "fines_penalties_income",
  "notarial_fee_income",
  "water_revenue_members",
  "water_revenue_nonmembers",
  "water_connection_fee_income",
  "penalty_income_water",
  "water_revenue_adjustments",
  "senior_citizen_discounts",
  "sales",
  "sales_returns",
  "membership_fee_income",
  "cost_of_sales",
  "interest_expense_deposits",
  "depreciation_expense",
  "inventory_losses",
  "cash_short_over",
] as const;

const h = (code: string, name: string, type: AccountType, nb: NormalBalance, parentCode: string | null): CoaRow => ({
  code,
  name,
  type,
  normalBalance: nb,
  parentCode,
  isPostable: false,
  scaCode: null,
  mappingKeys: [],
});
const p = (code: string, name: string, type: AccountType, nb: NormalBalance, parentCode: string, keys: string[] = []): CoaRow => ({
  code,
  name,
  type,
  normalBalance: nb,
  parentCode,
  isPostable: true,
  scaCode: null,
  mappingKeys: keys,
});

/**
 * PROVISIONAL chart of accounts, used only until PCMPC provides its own (Q-03.1). The structure
 * follows the CDA Revised Standard Chart of Accounts groups (1 Assets … 5 Expenses); codes and
 * names must be replaced by the cooperative's actual COA before go-live.
 */
export const PROVISIONAL_COA: CoaRow[] = [
  h("1", "ASSETS", "ASSET", "DR", null),
  h("11000", "Cash and Cash Equivalents", "ASSET", "DR", "1"),
  p("11110", "Cash on Hand", "ASSET", "DR", "11000", ["cash_on_hand"]),
  p("11130", "Cash in Bank", "ASSET", "DR", "11000", ["cash_in_bank"]),
  h("11200", "Loans and Receivables", "ASSET", "DR", "1"),
  p("11210", "Loans Receivable - Regular", "ASSET", "DR", "11200", ["loans_receivable_REG"]),
  p("11220", "Loans Receivable - Emergency", "ASSET", "DR", "11200", ["loans_receivable_EMR"]),
  p("11230", "Loans Receivable - Productive", "ASSET", "DR", "11200", ["loans_receivable_PRD"]),
  p("11250", "Accounts Receivable - Members", "ASSET", "DR", "11200", ["accounts_receivable_members"]),
  p("11260", "Accounts Receivable - Water", "ASSET", "DR", "11200", ["ar_water"]),
  p("11270", "Subscription Receivable - Common", "ASSET", "DR", "11200", ["subscription_receivable_common"]),
  p("11290", "Allowance for Probable Losses", "ASSET", "CR", "11200", ["allowance_probable_losses"]),
  h("11300", "Inventories", "ASSET", "DR", "1"),
  p("11310", "Merchandise Inventory", "ASSET", "DR", "11300", ["merchandise_inventory"]),

  h("2", "LIABILITIES", "LIABILITY", "CR", null),
  h("21000", "Deposit Liabilities", "LIABILITY", "CR", "2"),
  p("21110", "Savings Deposits", "LIABILITY", "CR", "21000", ["savings_deposits"]),
  p("21120", "Time Deposits", "LIABILITY", "CR", "21000", ["time_deposits"]),
  h("21200", "Payables", "LIABILITY", "CR", "2"),
  p("21210", "Accounts Payable - Trade", "LIABILITY", "CR", "21200", ["accounts_payable_trade"]),
  p("21220", "Customers' Deposits - Water", "LIABILITY", "CR", "21200", ["customers_deposits"]),
  p("21230", "Customers' Advances - Water", "LIABILITY", "CR", "21200", ["customers_advances"]),
  p("21240", "LPP Insurance Payable", "LIABILITY", "CR", "21200", ["lpp_insurance_payable"]),
  p("21250", "Withholding Tax Payable", "LIABILITY", "CR", "21200", ["withholding_tax_payable"]),
  p("21260", "CETF Payable", "LIABILITY", "CR", "21200", ["cetf_payable"]),
  p("21270", "Interest on Share Capital Payable", "LIABILITY", "CR", "21200", ["isc_payable"]),
  p("21280", "Patronage Refund Payable", "LIABILITY", "CR", "21200", ["patronage_refund_payable"]),

  h("3", "EQUITY", "EQUITY", "CR", null),
  h("31000", "Share Capital", "EQUITY", "CR", "3"),
  p("31110", "Subscribed Share Capital - Common", "EQUITY", "CR", "31000", ["subscribed_share_capital_common"]),
  h("32000", "Undivided Net Surplus and Statutory Funds", "EQUITY", "CR", "3"),
  p("32100", "Undivided Net Surplus", "EQUITY", "CR", "32000", ["undivided_net_surplus"]),
  p("32200", "Reserve Fund", "EQUITY", "CR", "32000", ["reserve_fund"]),
  p("32300", "Education and Training Fund (Local)", "EQUITY", "CR", "32000", ["education_training_fund"]),
  p("32400", "Community Development Fund", "EQUITY", "CR", "32000", ["community_development_fund"]),
  p("32500", "Optional Fund", "EQUITY", "CR", "32000", ["optional_fund"]),

  h("4", "REVENUES", "REVENUE", "CR", null),
  h("41000", "Income from Credit Operations", "REVENUE", "CR", "4"),
  p("41110", "Interest Income - Loans", "REVENUE", "CR", "41000", ["interest_income_loans"]),
  p("41120", "Service Fee Income", "REVENUE", "CR", "41000", ["service_fee_income"]),
  p("41130", "Fines and Penalties Income", "REVENUE", "CR", "41000", ["fines_penalties_income"]),
  p("41140", "Notarial Fee Income", "REVENUE", "CR", "41000", ["notarial_fee_income"]),
  h("42000", "Income from Water Service", "REVENUE", "CR", "4"),
  p("42110", "Water Revenue - Members", "REVENUE", "CR", "42000", ["water_revenue_members"]),
  p("42120", "Water Revenue - Non-members", "REVENUE", "CR", "42000", ["water_revenue_nonmembers"]),
  p("42130", "Water Connection Fee Income", "REVENUE", "CR", "42000", ["water_connection_fee_income"]),
  p("42140", "Penalty Income - Water", "REVENUE", "CR", "42000", ["penalty_income_water"]),
  p("42150", "Water Revenue Adjustments", "REVENUE", "DR", "42000", ["water_revenue_adjustments"]),
  p("42160", "Senior Citizen Discounts - Water", "REVENUE", "DR", "42000", ["senior_citizen_discounts"]),
  h("43000", "Income from Store", "REVENUE", "CR", "4"),
  p("43110", "Sales", "REVENUE", "CR", "43000", ["sales"]),
  p("43120", "Sales Returns and Allowances", "REVENUE", "DR", "43000", ["sales_returns"]),
  h("44000", "Other Income", "REVENUE", "CR", "4"),
  p("44110", "Membership Fee Income", "REVENUE", "CR", "44000", ["membership_fee_income"]),

  h("5", "EXPENSES", "EXPENSE", "DR", null),
  h("51000", "Cost of Sales", "EXPENSE", "DR", "5"),
  p("51110", "Cost of Sales - Store", "EXPENSE", "DR", "51000", ["cost_of_sales"]),
  h("52000", "Financing Cost", "EXPENSE", "DR", "5"),
  p("52110", "Interest Expense on Deposits", "EXPENSE", "DR", "52000", ["interest_expense_deposits"]),
  h("53000", "Operating Expenses", "EXPENSE", "DR", "5"),
  p("53110", "Depreciation Expense", "EXPENSE", "DR", "53000", ["depreciation_expense"]),
  p("53120", "Inventory Losses", "EXPENSE", "DR", "53000", ["inventory_losses"]),
  p("53130", "Cash Short / Over", "EXPENSE", "DR", "53000", ["cash_short_over"]),
];
