import Decimal from "decimal.js";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { businessToday, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { loanPayments, loanProducts, loans, loanSchedule } from "@/modules/loans/schema";
import { agingAsOf, delinquentOf } from "@/modules/loans/servicing";
import { maskTail } from "@/modules/members/masking";
import { members } from "@/modules/members/schema";
import { depositAccounts, depositProducts, depositTransactions, timeDeposits } from "@/modules/savings/schema";
import { reorderList } from "@/modules/store/reports";
import { salesReport, slowMovers } from "@/modules/store/sales-reports";
import type { Reconciliation } from "./kpis";

/**
 * The operational reports (PHASE-16 T16.4): one registry, shown on screen and exported to Excel.
 * A report's money totals are checked against the GL control account where one applies (the
 * reconciliation footer). Contact numbers are masked for viewers without reports.contacts.
 */

export type ColumnKind = "text" | "money" | "count" | "date" | "percent";
export type ReportColumn = { key: string; label: string; kind: ColumnKind };
export type Cell = string | number | Money | null;
export type ReportRow = Record<string, Cell>;
export type ReportResult = { title: string; columns: ReportColumn[]; rows: ReportRow[]; totals: ReportRow | null; reconciliation: Reconciliation[] };
export type ReportParams = { from: BusinessDate; to: BusinessDate; asOf: BusinessDate };
export type Viewer = { canSeeSensitive: boolean };
export type ParamKind = "range" | "asOf" | "none";

type ReportDef = { key: string; title: string; description: string; params: ParamKind; run: (p: ReportParams, viewer: Viewer, db: Db | Tx) => Promise<Omit<ReportResult, "title">> };

const POSTED = ["POSTED", "REVERSED"] as const;
const name = (m: { lastName: string; firstName: string }) => `${m.lastName}, ${m.firstName}`;
const col = (key: string, label: string, kind: ColumnKind = "text"): ReportColumn => ({ key, label, kind });
const sumOf = (rows: ReportRow[], key: string) => rows.reduce((s, r) => s + (typeof r[key] === "bigint" ? (r[key] as bigint) : 0n), 0n);
const rec = (label: string, gl: Money, subsidiary: Money): Reconciliation => ({ label, gl, subsidiary, difference: gl - subsidiary });

/** Debits − credits on the accounts mapped to the keys, between two dates (or up to `to` with no `from`). */
async function glMovement(db: Db | Tx, keys: { exact?: string[]; prefix?: string }, to: BusinessDate, from?: BusinessDate): Promise<Money> {
  const mapped = db
    .selectDistinct({ id: accountMappings.accountId })
    .from(accountMappings)
    .where(keys.prefix ? sql`starts_with(${accountMappings.key}, ${keys.prefix})` : inArray(accountMappings.key, keys.exact ?? []));
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(inArray(journalEntries.status, [...POSTED]), lte(journalEntries.entryDate, to), from ? gte(journalEntries.entryDate, from) : undefined, inArray(journalLines.accountId, mapped)));
  return BigInt(r?.s ?? "0");
}

export const REPORTS: ReportDef[] = [
  {
    key: "loan-releases",
    title: "Loan releases",
    description: "Loans released in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const list = await db
        .select({ loan: loans, product: loanProducts.name, member: members })
        .from(loans)
        .innerJoin(loanProducts, eq(loanProducts.id, loans.productId))
        .innerJoin(members, eq(members.id, loans.memberId))
        .where(and(gte(loans.releaseDate, p.from), lte(loans.releaseDate, p.to)))
        .orderBy(asc(loans.releaseDate), asc(loans.loanNo));
      const rows = list.map((r) => ({ releaseDate: r.loan.releaseDate, loanNo: r.loan.loanNo, memberNo: r.member.memberNo, name: name(r.member), product: r.product, term: r.loan.term, principal: r.loan.principal, status: r.loan.status }));
      return {
        columns: [col("releaseDate", "Released", "date"), col("loanNo", "Loan no."), col("memberNo", "Member no."), col("name", "Member"), col("product", "Product"), col("term", "Months", "count"), col("principal", "Principal", "money"), col("status", "Status")],
        rows,
        totals: { name: `${rows.length} loan(s)`, principal: sumOf(rows, "principal") },
        reconciliation: [],
      };
    },
  },
  {
    key: "loan-collections",
    title: "Loan collections",
    description: "Loan payments received in the period (cancelled receipts left out).",
    params: "range",
    run: async (p, _v, db) => {
      const list = await db
        .select({ pay: loanPayments, loanNo: loans.loanNo, member: members })
        .from(loanPayments)
        .innerJoin(loans, eq(loans.id, loanPayments.loanId))
        .innerJoin(members, eq(members.id, loans.memberId))
        .where(and(gte(loanPayments.payDate, p.from), lte(loanPayments.payDate, p.to), isNull(loanPayments.reversedBy)))
        .orderBy(asc(loanPayments.payDate), asc(loanPayments.seq));
      const rows = list.map((r) => ({ payDate: r.pay.payDate, loanNo: r.loanNo, memberNo: r.member.memberNo, name: name(r.member), kind: r.pay.kind, penalty: r.pay.penaltyPart, interest: r.pay.interestPart, principal: r.pay.principalPart, amount: r.pay.amount }));
      const interest = sumOf(rows, "interest");
      return {
        columns: [col("payDate", "Date", "date"), col("loanNo", "Loan no."), col("memberNo", "Member no."), col("name", "Member"), col("kind", "Kind"), col("penalty", "Penalty", "money"), col("interest", "Interest", "money"), col("principal", "Principal", "money"), col("amount", "Amount", "money")],
        rows,
        totals: { name: `${rows.length} payment(s)`, penalty: sumOf(rows, "penalty"), interest, principal: sumOf(rows, "principal"), amount: sumOf(rows, "amount") },
        reconciliation: [rec("Interest income on loans (GL credits in the period)", -(await glMovement(db, { exact: ["interest_income_loans"] }, p.to, p.from)), interest)],
      };
    },
  },
  {
    key: "delinquency",
    title: "Delinquency",
    description: "Loans past due, with what is overdue and the borrower's and comakers' contact numbers.",
    params: "asOf",
    run: async (p, v, db) => {
      // The rows and the footer come from the same aging: live for today, that day's snapshot for a past date.
      const aging = await agingAsOf(p.asOf, db);
      const list = await delinquentOf(aging.rows, db);
      const mobile = (m: string | null) => (v.canSeeSensitive ? m : maskTail(m));
      const rows = list.map((r) => ({
        loanNo: r.loan.loanNo,
        memberNo: r.member.memberNo,
        name: name(r.member),
        mobile: mobile(r.member.mobile),
        daysPastDue: r.daysPastDue,
        bucket: r.bucket,
        amountPastDue: r.amountPastDue,
        outstanding: r.outstandingPrincipal,
        comakers: r.comakers.map((c) => `${c.memberNo ?? ""} ${c.name} ${mobile(c.mobile) ?? ""}`.trim()).join("; "),
      }));
      const all = aging.rows.reduce((s, r) => s + r.outstandingPrincipal, 0n);
      const footer = aging.source === "live" || aging.rows.length > 0;
      return {
        columns: [col("loanNo", "Loan no."), col("memberNo", "Member no."), col("name", "Borrower"), col("mobile", "Mobile"), col("daysPastDue", "Days past due", "count"), col("bucket", "Bucket"), col("amountPastDue", "Past due", "money"), col("outstanding", "Outstanding", "money"), col("comakers", "Comakers")],
        rows,
        totals: { name: `${rows.length} loan(s)`, amountPastDue: sumOf(rows, "amountPastDue"), outstanding: sumOf(rows, "outstanding") },
        reconciliation: footer ? [rec("Loans receivable: whole portfolio (GL)", await glMovement(db, { prefix: "loans_receivable_" }, aging.asOf), all)] : [],
      };
    },
  },
  {
    key: "loan-maturities",
    title: "Loan maturity schedule",
    description: "Installments falling due in the period, with what is still unpaid.",
    params: "range",
    run: async (p, _v, db) => {
      const list = await db
        .select({ row: loanSchedule, loanNo: loans.loanNo, member: members })
        .from(loanSchedule)
        .innerJoin(loans, eq(loans.id, loanSchedule.loanId))
        .innerJoin(members, eq(members.id, loans.memberId))
        .where(and(gte(loanSchedule.dueDate, p.from), lte(loanSchedule.dueDate, p.to), inArray(loans.status, ["ACTIVE", "PAST_DUE", "PAID"])))
        .orderBy(asc(loanSchedule.dueDate), asc(loans.loanNo));
      const rows = list.map((r) => ({
        dueDate: r.row.dueDate,
        loanNo: r.loanNo,
        installment: r.row.no,
        memberNo: r.member.memberNo,
        name: name(r.member),
        principal: r.row.principalDue,
        interest: r.row.interestDue,
        unpaid: r.row.principalDue - r.row.principalPaid + r.row.interestDue - r.row.interestPaid,
      }));
      return {
        columns: [col("dueDate", "Due", "date"), col("loanNo", "Loan no."), col("installment", "No.", "count"), col("memberNo", "Member no."), col("name", "Member"), col("principal", "Principal", "money"), col("interest", "Interest", "money"), col("unpaid", "Unpaid", "money")],
        rows,
        totals: { name: `${rows.length} installment(s)`, principal: sumOf(rows, "principal"), interest: sumOf(rows, "interest"), unpaid: sumOf(rows, "unpaid") },
        reconciliation: [],
      };
    },
  },
  {
    key: "savings-interest",
    title: "Savings interest",
    description: "Interest credited to savings accounts in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const list = await db
        .select({ t: depositTransactions, accountNo: depositAccounts.accountNo, product: depositProducts.name, member: members })
        .from(depositTransactions)
        .innerJoin(depositAccounts, eq(depositAccounts.id, depositTransactions.accountId))
        .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
        .innerJoin(members, eq(members.id, depositAccounts.memberId))
        .where(and(inArray(depositTransactions.type, ["INTEREST", "WTAX"]), gte(depositTransactions.txnDate, p.from), lte(depositTransactions.txnDate, p.to)))
        .orderBy(asc(depositTransactions.txnDate), asc(depositAccounts.accountNo));
      const rows = list.map((r) => ({ date: r.t.txnDate, accountNo: r.accountNo, product: r.product, memberNo: r.member.memberNo, name: name(r.member), kind: r.t.type === "WTAX" ? "Withholding tax" : "Interest", amount: r.t.amount }));
      const gross = rows.filter((r) => r.kind === "Interest").reduce((s, r) => s + (r.amount as bigint), 0n);
      return {
        columns: [col("date", "Date", "date"), col("accountNo", "Account no."), col("product", "Product"), col("memberNo", "Member no."), col("name", "Member"), col("kind", "Entry"), col("amount", "Amount", "money")],
        rows,
        totals: { name: `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`, amount: sumOf(rows, "amount") },
        reconciliation: [rec("Interest expense on deposits (GL debits in the period)", await glMovement(db, { exact: ["interest_expense_deposits"] }, p.to, p.from), gross)],
      };
    },
  },
  {
    key: "td-maturities",
    title: "Time deposit maturities",
    description: "Time deposits maturing in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const list = await db
        .select({ td: timeDeposits, member: members })
        .from(timeDeposits)
        .innerJoin(depositAccounts, eq(depositAccounts.id, timeDeposits.accountId))
        .innerJoin(members, eq(members.id, depositAccounts.memberId))
        .where(and(gte(timeDeposits.maturityDate, p.from), lte(timeDeposits.maturityDate, p.to)))
        .orderBy(asc(timeDeposits.maturityDate));
      const rows = list.map((r) => ({ maturityDate: r.td.maturityDate, certificateNo: r.td.certificateNo, memberNo: r.member.memberNo, name: name(r.member), principal: r.td.principal, ratePa: r.td.ratePa, status: r.td.status }));
      return {
        columns: [col("maturityDate", "Matures", "date"), col("certificateNo", "Certificate no."), col("memberNo", "Member no."), col("name", "Member"), col("principal", "Principal", "money"), col("ratePa", "Rate p.a.", "percent"), col("status", "Status")],
        rows,
        totals: { name: `${rows.length} time deposit(s)`, principal: sumOf(rows, "principal") },
        reconciliation: [],
      };
    },
  },
  {
    key: "store-sales",
    title: "Store sales by product",
    description: "Net sales, cost of sales and gross margin per product in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const r = await salesReport(p.from, p.to, db);
      const rows = r.byProduct.map((x) => ({ sku: x.product.sku, product: x.product.name, category: x.product.category ?? "", qty: x.qty, net: x.net, cogs: x.cogs, margin: x.margin, marginPct: `${x.marginPct}%` }));
      const glSales = -(await glMovement(db, { exact: ["sales", "sales_returns"] }, p.to, p.from));
      return {
        columns: [col("sku", "SKU"), col("product", "Product"), col("category", "Category"), col("qty", "Qty", "count"), col("net", "Net sales", "money"), col("cogs", "Cost of sales", "money"), col("margin", "Gross margin", "money"), col("marginPct", "Margin %")],
        rows,
        totals: { product: "Total", net: r.total.net, cogs: r.total.cogs, margin: r.total.margin, marginPct: `${r.total.marginPct}%` },
        reconciliation: [rec("Net sales (GL sales less returns in the period)", glSales, r.total.net)],
      };
    },
  },
  {
    key: "store-margin",
    title: "Store gross margin by category",
    description: "Net sales and gross margin per category in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const r = await salesReport(p.from, p.to, db);
      const rows = r.byCategory.map((x) => ({ category: x.category ?? "Uncategorized", net: x.net, cogs: x.cogs, margin: x.margin, marginPct: `${x.marginPct}%` }));
      return {
        columns: [col("category", "Category"), col("net", "Net sales", "money"), col("cogs", "Cost of sales", "money"), col("margin", "Gross margin", "money"), col("marginPct", "Margin %")],
        rows,
        totals: { category: "Total", net: r.total.net, cogs: r.total.cogs, margin: r.total.margin, marginPct: `${r.total.marginPct}%` },
        reconciliation: [],
      };
    },
  },
  {
    key: "slow-movers",
    title: "Slow movers",
    description: "Products in stock that sold least in the period.",
    params: "range",
    run: async (p, _v, db) => {
      const list = await slowMovers(p.from, p.to, 50, db);
      const rows = list.map((x) => ({ sku: x.product.sku, product: x.product.name, onHand: x.onHand, value: x.value, soldQty: x.soldQty, lastSold: x.lastSold }));
      return {
        columns: [col("sku", "SKU"), col("product", "Product"), col("onHand", "On hand", "count"), col("value", "Stock value", "money"), col("soldQty", "Sold", "count"), col("lastSold", "Last sold", "date")],
        rows,
        totals: null,
        reconciliation: [],
      };
    },
  },
  {
    key: "reorder",
    title: "Reorder list",
    description: "Products at or below their reorder level.",
    params: "none",
    run: async (_p, _v, db) => {
      const list = await reorderList(db);
      const rows = list.map((x) => ({ sku: x.product.sku, product: x.product.name, category: x.category ?? "", onHand: x.qty, reorderLevel: x.product.reorderLevel, onOrder: Number(x.onOrder) }));
      return {
        columns: [col("sku", "SKU"), col("product", "Product"), col("category", "Category"), col("onHand", "On hand", "count"), col("reorderLevel", "Reorder level", "count"), col("onOrder", "On order", "count")],
        rows,
        totals: null,
        reconciliation: [],
      };
    },
  },
];

/** A cell as text or a number for showing: amounts as ₱, rates (fractions) as percentages. */
export function displayCell(v: Cell, kind: ColumnKind): string | number | null {
  if (typeof v === "bigint") return format(v);
  if (kind === "percent" && typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return `${new Decimal(v).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}%`;
  return v;
}

export function reportDef(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Runs a report for a viewer (sensitive fields masked unless they may see them). */
export async function runReport(key: string, params: Partial<ReportParams>, viewer: Viewer, db: Db | Tx = getDb()): Promise<ReportResult> {
  const def = reportDef(key);
  if (!def) throw new Error(`unknown report ${key}`);
  const today = businessToday();
  const p: ReportParams = { from: params.from ?? `${today.slice(0, 7)}-01`, to: params.to ?? today, asOf: params.asOf ?? today };
  return { title: def.title, ...(await def.run(p, viewer, db)) };
}
