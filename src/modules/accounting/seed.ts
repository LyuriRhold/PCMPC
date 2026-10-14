import type { Tx } from "@/db/client";
import { accountMappings, accounts } from "@/modules/ledger/schema";
import { SAMPLE_ASSET_CLASSES } from "@/modules/ledger/provisional-coa";
import { accountSegments, assetClasses, fsLineAccounts, fsLines, segments, type CashFlowClass, type FsSection, type StatementCode } from "./schema";

/**
 * The statement layout (PFRF for Cooperatives, CONFIRM with the bookkeeper and auditor), the
 * business segments, and the default mapping of the chart of accounts onto both. Idempotent: an
 * account already mapped is never moved; accounts the rules don't reach stay unmapped, and the
 * statements refuse to run until someone maps them (Financial statements › Account mapping).
 */

type LineSeed = { code: string; caption: string; sortOrder: number; statement: StatementCode; section: FsSection; cashFlow: CashFlowClass | null; computed?: boolean };

export const FS_LINE_SEED: LineSeed[] = [
  { code: "CASH", caption: "Cash and cash equivalents", sortOrder: 10, statement: "SFC", section: "ASSETS", cashFlow: "CASH" },
  { code: "LOANS", caption: "Loans receivable, net of allowance", sortOrder: 20, statement: "SFC", section: "ASSETS", cashFlow: "OPERATING" },
  { code: "RECEIVABLES", caption: "Accounts receivable", sortOrder: 30, statement: "SFC", section: "ASSETS", cashFlow: "OPERATING" },
  { code: "INVENTORIES", caption: "Inventories", sortOrder: 40, statement: "SFC", section: "ASSETS", cashFlow: "OPERATING" },
  { code: "OTHER_ASSETS", caption: "Other assets", sortOrder: 50, statement: "SFC", section: "ASSETS", cashFlow: "OPERATING" },
  { code: "PPE", caption: "Property and equipment, at cost", sortOrder: 60, statement: "SFC", section: "ASSETS", cashFlow: "INVESTING" },
  { code: "PPE_DEPRECIATION", caption: "Less: accumulated depreciation", sortOrder: 70, statement: "SFC", section: "ASSETS", cashFlow: "OPERATING" },
  { code: "DEPOSITS", caption: "Deposit liabilities", sortOrder: 110, statement: "SFC", section: "LIABILITIES", cashFlow: "OPERATING" },
  { code: "PAYABLES", caption: "Accounts payable – trade", sortOrder: 120, statement: "SFC", section: "LIABILITIES", cashFlow: "OPERATING" },
  { code: "OTHER_PAYABLES", caption: "Accrued expenses and other payables", sortOrder: 130, statement: "SFC", section: "LIABILITIES", cashFlow: "OPERATING" },
  { code: "SHARE_CAPITAL", caption: "Paid-up share capital", sortOrder: 210, statement: "SFC", section: "EQUITY", cashFlow: "FINANCING" },
  { code: "STATUTORY_FUNDS", caption: "Statutory funds", sortOrder: 220, statement: "SFC", section: "EQUITY", cashFlow: "FINANCING" },
  { code: "UNS", caption: "Undivided net surplus", sortOrder: 230, statement: "SFC", section: "EQUITY", cashFlow: "FINANCING" },
  { code: "NET_SURPLUS", caption: "Net surplus for the year", sortOrder: 240, statement: "SFC", section: "EQUITY", cashFlow: null, computed: true },
  { code: "SALES", caption: "Sales, net of returns", sortOrder: 310, statement: "SOO", section: "REVENUE", cashFlow: null },
  { code: "INTEREST_LOANS", caption: "Interest income on loans", sortOrder: 320, statement: "SOO", section: "REVENUE", cashFlow: null },
  { code: "CREDIT_FEES", caption: "Service fees, fines and other credit income", sortOrder: 330, statement: "SOO", section: "REVENUE", cashFlow: null },
  { code: "WATER", caption: "Water service revenue", sortOrder: 340, statement: "SOO", section: "REVENUE", cashFlow: null },
  { code: "OTHER_INCOME", caption: "Other income", sortOrder: 350, statement: "SOO", section: "REVENUE", cashFlow: null },
  { code: "COST_OF_SALES", caption: "Cost of sales", sortOrder: 410, statement: "SOO", section: "EXPENSE", cashFlow: null },
  { code: "FINANCING_COST", caption: "Interest expense on deposits", sortOrder: 420, statement: "SOO", section: "EXPENSE", cashFlow: null },
  { code: "OPERATING_EXPENSES", caption: "Operating expenses", sortOrder: 430, statement: "SOO", section: "EXPENSE", cashFlow: null },
];

/** Default mapping: by DOMAIN §6 key first, then by the account's heading in the provisional chart. */
type Rule = { line: string; keys?: string[]; keyPrefixes?: string[]; parents?: string[] };

const LINE_RULES: Rule[] = [
  { line: "CASH", keys: ["cash_on_hand", "cash_in_bank"] },
  { line: "LOANS", keyPrefixes: ["loans_receivable_"], keys: ["allowance_probable_losses"] },
  { line: "SHARE_CAPITAL", keys: ["subscribed_share_capital_common", "subscription_receivable_common"] },
  { line: "RECEIVABLES", keys: ["accounts_receivable_members", "ar_water"] },
  { line: "INVENTORIES", keys: ["merchandise_inventory"] },
  { line: "PPE", keyPrefixes: ["property_equipment_"] },
  { line: "PPE_DEPRECIATION", keyPrefixes: ["accumulated_depreciation_"] },
  { line: "DEPOSITS", keys: ["savings_deposits", "time_deposits"] },
  { line: "PAYABLES", keys: ["accounts_payable_trade"] },
  { line: "UNS", keys: ["undivided_net_surplus"] },
  { line: "STATUTORY_FUNDS", keys: ["reserve_fund", "education_training_fund", "community_development_fund", "optional_fund"] },
  { line: "SALES", keys: ["sales", "sales_returns"] },
  { line: "INTEREST_LOANS", keys: ["interest_income_loans"] },
  { line: "COST_OF_SALES", keys: ["cost_of_sales"] },
  { line: "FINANCING_COST", keys: ["interest_expense_deposits"] },
  // Headings of the provisional chart.
  { line: "CASH", parents: ["11000"] },
  { line: "RECEIVABLES", parents: ["11200"] },
  { line: "INVENTORIES", parents: ["11300"] },
  { line: "OTHER_ASSETS", parents: ["1"] },
  { line: "DEPOSITS", parents: ["21000"] },
  { line: "OTHER_PAYABLES", parents: ["21200", "2"] },
  { line: "SHARE_CAPITAL", parents: ["31000"] },
  { line: "STATUTORY_FUNDS", parents: ["32000"] },
  { line: "CREDIT_FEES", parents: ["41000"] },
  { line: "WATER", parents: ["42000"] },
  { line: "SALES", parents: ["43000"] },
  { line: "OTHER_INCOME", parents: ["44000", "4"] },
  { line: "COST_OF_SALES", parents: ["51000"] },
  { line: "FINANCING_COST", parents: ["52000"] },
  { line: "OPERATING_EXPENSES", parents: ["53000", "5"] },
];

export const SEGMENT_SEED = [
  { code: "WATER", name: "Water service", sortOrder: 1 },
  { code: "CREDIT", name: "Credit (savings and loans)", sortOrder: 2 },
  { code: "CONSUMER", name: "Consumer store", sortOrder: 3 },
  { code: "GENERAL", name: "General", sortOrder: 4 },
];

const SEGMENT_RULES: Array<Rule & { segment: string }> = [
  { line: "", segment: "CREDIT", keys: ["recovery_income_loans"], parents: ["41000", "52000"] },
  { line: "", segment: "WATER", parents: ["42000"] },
  { line: "", segment: "CONSUMER", keys: ["inventory_losses", "inventory_gains"], parents: ["43000", "51000"] },
];

type AccountRow = { id: string; code: string; type: string; isPostable: boolean; parentCode: string | null; keys: string[] };

function matches(rule: Rule, a: AccountRow, pass: "keys" | "parents"): boolean {
  if (pass === "keys") return a.keys.some((k) => rule.keys?.includes(k) || rule.keyPrefixes?.some((p) => k.startsWith(p)));
  return !!a.parentCode && !!rule.parents?.includes(a.parentCode);
}

async function chart(tx: Tx): Promise<AccountRow[]> {
  const all = await tx.select({ id: accounts.id, code: accounts.code, type: accounts.type, isPostable: accounts.isPostable, parentId: accounts.parentId }).from(accounts);
  const codeOf = new Map(all.map((a) => [a.id, a.code]));
  const rows = all.map((a) => ({ id: a.id, code: a.code, type: a.type as string, isPostable: a.isPostable, parentCode: a.parentId ? (codeOf.get(a.parentId) ?? null) : null }));
  const maps = await tx.select({ key: accountMappings.key, accountId: accountMappings.accountId }).from(accountMappings);
  return rows.map((r) => ({ ...r, keys: maps.filter((m) => m.accountId === r.id).map((m) => m.key) }));
}

const SFC_TYPES = ["ASSET", "LIABILITY", "EQUITY"];

/** Seed step: statement lines, segments, asset classes and the default mapping of unmapped accounts. */
export async function seedFs(tx: Tx): Promise<void> {
  await tx
    .insert(fsLines)
    .values(FS_LINE_SEED.map((l) => ({ ...l, computed: l.computed ?? false })))
    .onConflictDoNothing({ target: fsLines.code });
  await tx.insert(segments).values(SEGMENT_SEED).onConflictDoNothing({ target: segments.code });
  await tx
    .insert(assetClasses)
    .values(SAMPLE_ASSET_CLASSES.map((c) => ({ code: c.code, name: c.name, defaultLifeMonths: c.lifeMonths })))
    .onConflictDoNothing({ target: assetClasses.code });

  const lines = await tx.select().from(fsLines);
  const lineByCode = new Map(lines.map((l) => [l.code, l]));
  const mapped = new Set((await tx.select({ accountId: fsLineAccounts.accountId }).from(fsLineAccounts)).map((m) => m.accountId));
  const segmented = new Set((await tx.select({ accountId: accountSegments.accountId }).from(accountSegments)).map((m) => m.accountId));
  const all = (await chart(tx)).filter((a) => a.isPostable);

  for (const a of all) {
    if (!mapped.has(a.id)) {
      const wantsSfc = SFC_TYPES.includes(a.type);
      const fits = (r: Rule) => lineByCode.get(r.line)?.statement === (wantsSfc ? "SFC" : "SOO");
      const rule = LINE_RULES.find((r) => fits(r) && matches(r, a, "keys")) ?? LINE_RULES.find((r) => fits(r) && matches(r, a, "parents"));
      const line = rule ? lineByCode.get(rule.line) : undefined;
      if (line) await tx.insert(fsLineAccounts).values({ fsLineId: line.id, accountId: a.id });
    }
    if (!segmented.has(a.id) && (a.type === "REVENUE" || a.type === "EXPENSE")) {
      const rule = SEGMENT_RULES.find((r) => matches(r, a, "keys")) ?? SEGMENT_RULES.find((r) => matches(r, a, "parents"));
      if (rule) await tx.insert(accountSegments).values({ accountId: a.id, segmentCode: rule.segment });
    }
  }
}
