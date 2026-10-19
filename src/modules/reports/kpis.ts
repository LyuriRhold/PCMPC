import Decimal from "decimal.js";
import { and, eq, gte, inArray, like, lte, ne, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { addDays, businessToday, monthEnd, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { parPercent } from "@/modules/loans/aging";
import { loans, loanSchedule } from "@/modules/loans/schema";
import { portfolio } from "@/modules/loans/servicing";
import { depositAccounts, depositTransactions, timeDeposits } from "@/modules/savings/schema";
import { getSetting } from "@/modules/settings/service";
import { shareTotals } from "@/modules/share/service";
import { reorderList } from "@/modules/store/reports";
import { salesReport } from "@/modules/store/sales-reports";
import { disconnectionList } from "@/modules/water/collections";
import { collectionEfficiency, nrw } from "@/modules/water/reports";
import { waterAccounts } from "@/modules/water/schema";
import { membershipSummary, newMembersThisMonth } from "./membership";
import { members } from "@/modules/members/schema";

/**
 * The management dashboard (PHASE-16 T16.3), server-computed. Money balances come from the GL
 * control accounts; a reconciliation compares them with the subsidiary records (loan schedules,
 * deposit passbooks, the share registry) and shows any difference.
 */

const POSTED = ["POSTED", "REVERSED"] as const;

/** Collection efficiency: collected on the dues falling in a period ÷ the dues, as "92.50%" (null with no dues). */
export function efficiencyPercent(due: Money, collected: Money): string | null {
  if (due <= 0n) return null;
  return `${new Decimal(collected.toString()).mul(100).div(due.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)}%`;
}

/** A GL balance (debit − credit) as of a date for the accounts mapped to the keys (or keys starting with a prefix). */
async function gl(keys: { exact?: string[]; prefix?: string }, asOf: BusinessDate, db: Db | Tx): Promise<Money> {
  const keyFilter = or(keys.exact?.length ? inArray(accountMappings.key, keys.exact) : undefined, keys.prefix ? like(accountMappings.key, `${keys.prefix}%`) : undefined);
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(
      and(
        inArray(journalEntries.status, [...POSTED]),
        lte(journalEntries.entryDate, asOf),
        inArray(journalLines.accountId, db.selectDistinct({ id: accountMappings.accountId }).from(accountMappings).where(keyFilter)),
      ),
    );
  return BigInt(r?.s ?? "0");
}

/** Loan collection efficiency of a month: interest and principal paid on the installments due in it ÷ what they were due. */
export async function loanCollectionEfficiency(month: string, db: Db | Tx = getDb()) {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const [r] = await db
    .select({
      due: sql<string>`coalesce(sum(${loanSchedule.principalDue} + ${loanSchedule.interestDue}), 0)::text`,
      paid: sql<string>`coalesce(sum(${loanSchedule.principalPaid} + ${loanSchedule.interestPaid}), 0)::text`,
    })
    .from(loanSchedule)
    .innerJoin(loans, eq(loans.id, loanSchedule.loanId))
    .where(and(gte(loanSchedule.dueDate, from), lte(loanSchedule.dueDate, to), inArray(loans.status, ["ACTIVE", "PAST_DUE", "PAID"])));
  const due = BigInt(r?.due ?? "0");
  const collected = BigInt(r?.paid ?? "0");
  return { month, due, collected, percent: efficiencyPercent(due, collected) };
}

export type Reconciliation = { label: string; gl: Money; subsidiary: Money; difference: Money };

/** Every dashboard figure as of today. */
export async function dashboardKpis(db: Db | Tx = getDb()) {
  const today = businessToday();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);

  // Capital, deposits and loans from the GL control accounts.
  const subscribed = -(await gl({ exact: ["subscribed_share_capital_common"] }, today, db));
  const receivable = await gl({ exact: ["subscription_receivable_common"] }, today, db);
  const paidUp = subscribed - receivable;
  const deposits = -(await gl({ exact: ["savings_deposits", "time_deposits"] }, today, db));
  const loanPortfolio = await gl({ prefix: "loans_receivable_" }, today, db);
  const cash = { onHand: await gl({ exact: ["cash_on_hand"] }, today, db), inBank: await gl({ exact: ["cash_in_bank"] }, today, db) };

  const rows = await portfolio(today, db);
  const threshold = await getSetting("loan.par_threshold_days", db);
  const subsidiaryLoans = rows.reduce((s, r) => s + r.outstandingPrincipal, 0n);
  const [passbooks] = await db.select({ s: sql<string>`coalesce(sum(${depositTransactions.amount}), 0)::text` }).from(depositTransactions);
  const [placed] = await db.select({ s: sql<string>`coalesce(sum(${timeDeposits.principal}), 0)::text` }).from(timeDeposits).where(eq(timeDeposits.status, "ACTIVE"));
  const subsidiaryDeposits = BigInt(passbooks?.s ?? "0") + BigInt(placed?.s ?? "0");
  const shares = await shareTotals(db);

  const efficiency = await collectionEfficiency(month, db);
  const [active] = await db.select({ n: sql<number>`count(*)::int` }).from(waterAccounts).where(eq(waterAccounts.status, "ACTIVE"));
  const waterNrw = await nrw(month, db);

  const mtd = (await salesReport(`${month}-01`, today, db)).total;
  const ytd = (await salesReport(`${year}-01-01`, today, db)).total;

  const weekEnd = addDays(today, 6);
  const [dueThisWeek] = await db
    .select({
      n: sql<number>`count(distinct ${loanSchedule.loanId})::int`,
      amount: sql<string>`coalesce(sum(${loanSchedule.principalDue} - ${loanSchedule.principalPaid} + ${loanSchedule.interestDue} - ${loanSchedule.interestPaid}), 0)::text`,
    })
    .from(loanSchedule)
    .innerJoin(loans, eq(loans.id, loanSchedule.loanId))
    .where(and(gte(loanSchedule.dueDate, today), lte(loanSchedule.dueDate, weekEnd), ne(loanSchedule.status, "PAID"), inArray(loans.status, ["ACTIVE", "PAST_DUE"])));
  const maturing = await db
    .select({ id: timeDeposits.id, maturityDate: timeDeposits.maturityDate, principal: timeDeposits.principal, memberNo: members.memberNo, lastName: members.lastName })
    .from(timeDeposits)
    .innerJoin(depositAccounts, eq(depositAccounts.id, timeDeposits.accountId))
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .where(and(eq(timeDeposits.status, "ACTIVE"), gte(timeDeposits.maturityDate, today), lte(timeDeposits.maturityDate, weekEnd)));
  const lowStock = await reorderList(db);

  const reconciliation: Reconciliation[] = [
    { label: "Loans receivable (loan schedules)", gl: loanPortfolio, subsidiary: subsidiaryLoans, difference: loanPortfolio - subsidiaryLoans },
    { label: "Deposits (savings passbooks and time deposits)", gl: deposits, subsidiary: subsidiaryDeposits, difference: deposits - subsidiaryDeposits },
    { label: "Paid-up share capital (share registry)", gl: paidUp, subsidiary: shares.paidUp, difference: paidUp - shares.paidUp },
  ];

  return {
    asOf: today,
    members: { ...(await membershipSummary(db)), newThisMonth: await newMembersThisMonth(db) },
    paidUp,
    deposits,
    loanPortfolio,
    par: { thresholdDays: threshold, percent: `${parPercent(rows, threshold)}%` },
    loanEfficiency: await loanCollectionEfficiency(month, db),
    water: {
      month,
      billed: efficiency.billed,
      collected: efficiency.collected,
      efficiency: efficiency.percent === null ? null : `${efficiency.percent}%`,
      activeConnections: active?.n ?? 0,
      forDisconnection: (await disconnectionList(db)).length,
      nrw: waterNrw.nrwPercent === null ? null : `${waterNrw.nrwPercent}%`,
    },
    store: { mtd: { net: mtd.net, margin: mtd.margin, marginPct: `${mtd.marginPct}%` }, ytd: { net: ytd.net, margin: ytd.margin, marginPct: `${ytd.marginPct}%` } },
    cash,
    alerts: {
      loansDueThisWeek: { loans: dueThisWeek?.n ?? 0, amount: BigInt(dueThisWeek?.amount ?? "0") },
      maturingTimeDeposits: maturing,
      lowStock: lowStock.length,
    },
    reconciliation,
  };
}

export type DashboardKpis = Awaited<ReturnType<typeof dashboardKpis>>;
