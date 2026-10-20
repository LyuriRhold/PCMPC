import "@/modules/plugins";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, withTx, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { dailyJobs, runDailyJobs } from "@/lib/cron";
import { addDays, businessToday, formatDate, monthEnd, type BusinessDate } from "@/lib/dates";
import { hasRun } from "@/lib/jobs";
import { format, type Money } from "@/lib/money";
import { posShifts } from "@/modules/store/schema";
import { tellerSessions } from "@/modules/cashiering/schema";
import { jobRuns } from "@/modules/jobs/schema";
import { ensureFiscalYear } from "@/modules/ledger/periods";
import { accounts, fiscalYears, journalEntries, journalLines, periods } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { depositAccounts, depositProducts } from "@/modules/savings/schema";
import { waterBillingPeriods, waterZones } from "@/modules/water/schema";
import { AccountingError, depreciationDone } from "./assets";
import { reconsDone } from "./bank";
import { closeChecklists, yearEndCloses } from "./schema";
import { CLOSING_SOURCE } from "./statements";

/**
 * Period close (PHASE-14 T14.5). A month closes only when its checklist passes; closing locks it
 * (no posting dated in it). Reopening needs the administrator, a reason and leaves an audit entry.
 * The year-end close empties every revenue and expense account into Undivided Net Surplus with one
 * entry dated the year's last day, closes the last month and the year, and opens the next year;
 * the new year's opening balances are the closing balance sheet (balances carry forward).
 */

export type CheckItem = { key: string; label: string; ok: boolean; detail: string };

const POSTED = ["POSTED", "REVERSED"] as const;
const pad = (m: number) => String(m).padStart(2, "0");
const label = (year: number, month: number) => `${year}-${pad(month)}`;

/** The first business date of the books (the earliest posted entry): no daily jobs were due before it. */
async function goLive(db: Db | Tx): Promise<BusinessDate | null> {
  const [r] = await db.select({ d: sql<string | null>`min(${journalEntries.entryDate})::text` }).from(journalEntries).where(inArray(journalEntries.status, [...POSTED]));
  return r?.d ?? null;
}

/** The dates of a month (from go-live, through `through`) on which each daily job hasn't run. */
async function missedJobs(year: number, month: number, through: BusinessDate, db: Db | Tx): Promise<Map<string, BusinessDate[]>> {
  const from = `${label(year, month)}-01`;
  const end = monthEnd(from);
  const to = through < end ? through : end;
  const start = await goLive(db);
  const missed = new Map<string, BusinessDate[]>();
  if (!start || start > to) return missed;
  const dates: BusinessDate[] = [];
  for (let d = start > from ? start : from; d <= to; d = addDays(d, 1)) dates.push(d);
  const names = dailyJobs().map((j) => j.name);
  const runs = names.length ? await db.select({ job: jobRuns.job, key: jobRuns.key }).from(jobRuns).where(and(inArray(jobRuns.job, names), inArray(jobRuns.key, dates))) : [];
  const done = new Set(runs.map((r) => `${r.job}:${r.key}`));
  for (const job of names) {
    const gaps = dates.filter((d) => !done.has(`${job}:${d}`));
    if (gaps.length) missed.set(job, gaps);
  }
  return missed;
}

/** The month-close checklist; every item must pass. */
export async function monthChecklist(year: number, month: number, db: Db | Tx = getDb()): Promise<CheckItem[]> {
  const period = label(year, month);
  const from = `${period}-01`;
  const to = monthEnd(from);
  const items: CheckItem[] = [];

  const sessions = await db.select({ status: tellerSessions.status }).from(tellerSessions).where(and(gte(tellerSessions.businessDate, from), lte(tellerSessions.businessDate, to)));
  const unverified = sessions.filter((s) => s.status !== "VERIFIED");
  items.push({ key: "teller_sessions", label: "Teller sessions verified", ok: unverified.length === 0, detail: unverified.length ? `${unverified.length} of ${sessions.length} not verified yet` : `${sessions.length} verified` });

  const shifts = await db.select({ status: posShifts.status }).from(posShifts).where(and(gte(posShifts.businessDate, from), lte(posShifts.businessDate, to)));
  const openShifts = shifts.filter((s) => s.status !== "VERIFIED");
  items.push({ key: "pos_shifts", label: "POS shifts closed and verified", ok: openShifts.length === 0, detail: openShifts.length ? `${openShifts.length} of ${shifts.length} not closed and verified` : `${shifts.length} verified` });

  const billing = await db.select({ status: waterBillingPeriods.status, zone: waterZones.name }).from(waterBillingPeriods).innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId)).where(eq(waterBillingPeriods.period, period));
  const unbilled = billing.filter((b) => b.status !== "BILLED" && b.status !== "CLOSED");
  items.push({ key: "water_billing", label: "Water billing of the month posted", ok: unbilled.length === 0, detail: unbilled.length ? `Not posted: ${unbilled.map((b) => `${b.zone} (${b.status})`).join(", ")}` : billing.length ? `${billing.length} zone(s) billed` : "No water billing this month" });

  const [drafts] = await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(and(eq(journalEntries.status, "DRAFT"), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)));
  items.push({ key: "draft_jvs", label: "No draft journal vouchers", ok: (drafts?.n ?? 0) === 0, detail: drafts?.n ? `${drafts.n} draft JV(s) dated this month` : "None" });

  const missing = [...(await missedJobs(year, month, to, db))].map(([job, gaps]) => `${job} on ${gaps.length} date(s) from ${formatDate(gaps[0]!)}`);
  items.push({ key: "daily_jobs", label: "Daily jobs ran for every business date", ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.join("; ")}` : "All ran" });

  const dep = await depreciationDone(period, db);
  items.push({ key: "depreciation", label: "Depreciation run posted", ...dep });

  if (month % 3 === 0) {
    const products = await db.select().from(depositProducts).where(eq(depositProducts.kind, "SAVINGS"));
    const notRun: string[] = [];
    for (const p of products) {
      const [acct] = await db.select({ id: depositAccounts.id }).from(depositAccounts).where(and(eq(depositAccounts.productId, p.id), lte(depositAccounts.openedAt, to))).limit(1);
      if (acct && !(await hasRun(db, "savings-interest", `${p.code}:${to}`))) notRun.push(p.name);
    }
    items.push({ key: "savings_interest", label: "Savings interest run (quarter end)", ok: notRun.length === 0, detail: notRun.length ? `Not run: ${notRun.join(", ")}` : "Done" });
  } else {
    items.push({ key: "savings_interest", label: "Savings interest run (quarter end)", ok: true, detail: "Not a quarter end" });
  }

  const bank = await reconsDone(period, db);
  items.push({ key: "bank_recon", label: "Bank reconciliations saved", ...bank });
  return items;
}

async function lockPeriod(tx: Tx, year: number, month: number) {
  const [p] = await tx.select().from(periods).where(and(eq(periods.year, year), eq(periods.month, month))).for("update");
  if (!p) throw new AccountingError(`Period ${label(year, month)} isn't set up`);
  return p;
}

async function recordChecklist(tx: Tx, period: string, items: CheckItem[], actorId: string) {
  await tx.insert(closeChecklists).values(items.map((i) => ({ period, item: i.key, status: i.ok ? "PASS" : "FAIL", detail: i.detail, by: actorId, createdBy: actorId })));
}

function assertOver(year: number, month: number) {
  const end = monthEnd(`${label(year, month)}-01`);
  if (end >= businessToday()) throw new AccountingError(`${label(year, month)} isn't over yet; close it from ${formatDate(addDays(end, 1))}`);
}

/** Closes a month (gl.close) when its checklist passes; the checklist is kept. */
export async function closeMonth(tx: Tx, input: { year: number; month: number }, actorId: string) {
  const p = await lockPeriod(tx, input.year, input.month);
  if (p.status !== "OPEN") throw new AccountingError(`${label(input.year, input.month)} is already closed`);
  assertOver(input.year, input.month);
  const items = await monthChecklist(input.year, input.month, tx);
  const failing = items.filter((i) => !i.ok);
  if (failing.length) throw new AccountingError(`${label(input.year, input.month)} can't be closed yet: ${failing.map((i) => `${i.label} (${i.detail})`).join("; ")}`);
  await recordChecklist(tx, label(input.year, input.month), items, actorId);
  await tx.update(periods).set({ status: "CLOSED", closedBy: actorId, closedAt: sql`now()` }).where(eq(periods.id, p.id));
  await audit(tx, { action: "gl.period_close", entity: "period", entityId: String(p.id), after: { period: label(input.year, input.month) }, userId: actorId });
}

/** Reopens a closed month (gl.reopen: the administrator) with a reason; not in a closed year. */
export async function reopenMonth(tx: Tx, input: { year: number; month: number; reason: string }, adminId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new AccountingError("Enter why the month is reopened");
  const [row] = await tx.select({ fiscalYearId: periods.fiscalYearId }).from(periods).where(and(eq(periods.year, input.year), eq(periods.month, input.month)));
  if (!row) throw new AccountingError(`Period ${label(input.year, input.month)} isn't set up`);
  // The year first, then the month: the same order as the year-end close, so neither waits on the other forever.
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, row.fiscalYearId)).for("update");
  const p = await lockPeriod(tx, input.year, input.month);
  if (p.status !== "CLOSED") throw new AccountingError(`${label(input.year, input.month)} is open`);
  if (fy?.status === "CLOSED") throw new AccountingError(`Fiscal year ${fy.year} is closed; its months can't be reopened`);
  await tx.update(periods).set({ status: "OPEN", closedBy: null, closedAt: null }).where(eq(periods.id, p.id));
  await audit(tx, { action: "gl.period_reopen", entity: "period", entityId: String(p.id), after: { period: label(input.year, input.month), reason }, userId: adminId });
}

/**
 * The year-end close (gl.close): every other month closed, the last month's checklist passing.
 * One entry dated the year's last day empties every revenue and expense account into Undivided
 * Net Surplus; then the last month and the year are closed and the next year is opened.
 */
export async function yearEndClose(tx: Tx, input: { year: number }, actorId: string) {
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.year, input.year)).for("update");
  if (!fy) throw new AccountingError(`Fiscal year ${input.year} isn't set up`);
  if (fy.status === "CLOSED") throw new AccountingError(`Fiscal year ${input.year} is already closed`);
  // The closing entry sweeps balances since the books began, so every earlier year must be closed into UNS.
  const [prior] = await tx.select().from(fiscalYears).where(eq(fiscalYears.year, input.year - 1));
  if (prior && prior.status !== "CLOSED") throw new AccountingError(`Close fiscal year ${prior.year} first`);
  const months = await tx.select().from(periods).where(eq(periods.fiscalYearId, fy.id)).orderBy(asc(periods.year), asc(periods.month)).for("update");
  const last = months.at(-1);
  if (!last) throw new AccountingError(`Fiscal year ${input.year} has no months`);
  const stillOpen = months.slice(0, -1).filter((m) => m.status !== "CLOSED");
  if (stillOpen.length) throw new AccountingError(`Close these months first: ${stillOpen.map((m) => label(m.year, m.month)).join(", ")}`);
  if (last.status !== "OPEN") throw new AccountingError(`${label(last.year, last.month)} must be open for the closing entry`);
  assertOver(last.year, last.month);
  const items = await monthChecklist(last.year, last.month, tx);
  const failing = items.filter((i) => !i.ok);
  if (failing.length) throw new AccountingError(`${label(last.year, last.month)} can't be closed yet: ${failing.map((i) => `${i.label} (${i.detail})`).join("; ")}`);

  // Revenue and expense balances as of the year's end (earlier years are already closed into UNS).
  const balances = await tx
    .select({ accountId: journalLines.accountId, type: accounts.type, net: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(inArray(journalEntries.status, [...POSTED]), lte(journalEntries.entryDate, fy.endDate), inArray(accounts.type, ["REVENUE", "EXPENSE"])))
    .groupBy(journalLines.accountId, accounts.type);
  const lines: LineInput[] = [];
  let netSurplus: Money = 0n;
  for (const b of balances) {
    const net = BigInt(b.net); // debit − credit
    if (net === 0n) continue;
    netSurplus -= net;
    lines.push(net > 0n ? { accountId: b.accountId, credit: net, memo: "Year-end close" } : { accountId: b.accountId, debit: -net, memo: "Year-end close" });
  }
  let jeId: string | null = null;
  if (lines.length) {
    const uns = await accountIdFor("undivided_net_surplus", tx);
    lines.push(netSurplus >= 0n ? { accountId: uns, credit: netSurplus, memo: `Net surplus ${input.year}` } : { accountId: uns, debit: -netSurplus, memo: `Net loss ${input.year}` });
    const je = await postJournal(
      tx,
      { date: fy.endDate, book: "GJ", particulars: `Year-end closing entry, fiscal year ${input.year}: revenues and expenses into Undivided Net Surplus`, reference: `CLOSE-${input.year}`, source: { module: CLOSING_SOURCE, id: null }, lines: lines.filter((l) => (l.debit ?? 0n) > 0n || (l.credit ?? 0n) > 0n) },
      actorId,
    );
    jeId = je.id;
  }
  await tx.insert(yearEndCloses).values({ year: input.year, netSurplus, jeId, closedBy: actorId, createdBy: actorId });
  await recordChecklist(tx, label(last.year, last.month), items, actorId);
  await tx.update(periods).set({ status: "CLOSED", closedBy: actorId, closedAt: sql`now()` }).where(eq(periods.id, last.id));
  await tx.update(fiscalYears).set({ status: "CLOSED" }).where(eq(fiscalYears.id, fy.id));
  await ensureFiscalYear(tx, input.year + 1);
  await audit(tx, { action: "gl.year_close", entity: "fiscal_year", entityId: String(fy.id), after: { year: input.year, netSurplus: format(netSurplus) }, userId: actorId });
  return { netSurplus, jeId };
}

/**
 * Runs the daily jobs for the dates of a month some job missed (the cron didn't run, or a job
 * failed), oldest first and only for past dates; stops at the first date where a job fails.
 */
export async function runMissedDailyJobs(input: { year: number; month: number }, actorId: string): Promise<{ dates: number }> {
  const period = label(input.year, input.month);
  const missed = await missedJobs(input.year, input.month, addDays(businessToday(), -1), getDb());
  const dates = [...new Set([...missed.values()].flat())].sort();
  if (!dates.length) throw new AccountingError(`No daily job is missing in ${period}`);
  let ran = 0;
  let failure: string | null = null;
  for (const d of dates) {
    const failed = (await runDailyJobs(d)).find((r) => r.status === "failed");
    if (failed) {
      failure = `${failed.job} failed on ${formatDate(d)}: ${failed.error ?? "unknown error"}`;
      break;
    }
    ran++;
  }
  await withTx((tx) => audit(tx, { action: "jobs.catch_up", entity: "period", entityId: period, after: { period, dates: ran, failure }, userId: actorId }));
  if (failure) throw new AccountingError(`Ran ${ran} date(s); ${failure}`);
  return { dates: ran };
}

/** A fiscal year's months with their status and when they were closed. */
export async function yearPeriods(year: number, db: Db | Tx = getDb()) {
  const [fy] = await db.select().from(fiscalYears).where(eq(fiscalYears.year, year));
  if (!fy) return null;
  const months = await db.select().from(periods).where(eq(periods.fiscalYearId, fy.id)).orderBy(asc(periods.year), asc(periods.month));
  const [closing] = await db.select().from(yearEndCloses).where(eq(yearEndCloses.year, year));
  return { fy, months, closing: closing ?? null };
}

/** The checklist kept when a month was closed (latest close first). */
export async function keptChecklist(period: string, db: Db | Tx = getDb()) {
  return db.select().from(closeChecklists).where(eq(closeChecklists.period, period)).orderBy(sql`${closeChecklists.at} DESC`);
}

/**
 * Closes every month up to and including the cut-off's (PHASE-17 data migration): the opening
 * entry is the books' first, and nothing may be posted before go-live. At a fiscal year end the
 * year is closed too and the next one opened.
 */
export async function closeThroughCutoff(tx: Tx, cutoff: BusinessDate, ref: string, actorId: string): Promise<{ months: number }> {
  const ym = Number(cutoff.slice(0, 4)) * 100 + Number(cutoff.slice(5, 7));
  const closed = await tx
    .update(periods)
    .set({ status: "CLOSED", closedBy: actorId, closedAt: sql`now()` })
    .where(and(eq(periods.status, "OPEN"), sql`${periods.year} * 100 + ${periods.month} <= ${ym}`))
    .returning({ id: periods.id, year: periods.year, month: periods.month });
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.endDate, cutoff));
  if (fy && fy.status === "OPEN") {
    await tx.update(fiscalYears).set({ status: "CLOSED" }).where(eq(fiscalYears.id, fy.id));
    await ensureFiscalYear(tx, fy.year + 1);
  }
  await audit(tx, { action: "gl.period_close", entity: "period", entityId: cutoff, after: { through: cutoff, months: closed.map((p) => label(p.year, p.month)), fiscalYearClosed: fy?.year ?? null, ref }, userId: actorId });
  return { months: closed.length };
}
