import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addDays, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { accounts, journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountSegments, fsLineAccounts, fsLines, segments, type CashFlowClass, type FsLine, type FsSection } from "./schema";

/**
 * The financial statements (PHASE-14 T14.2), computed from the GL through the statement lines each
 * account is mapped to: the Statement of Financial Condition, of Operations (by business segment),
 * of Changes in Equity and of Cash Flows (indirect), each with an optional comparative. Year-end
 * closing entries (source "ledger.close") are not operations: they are left out of the Statement of
 * Operations, the Cash Flows and the period movements, and shown as transfers in the equity statement.
 */

/** The source module of year-end closing entries. */
export const CLOSING_SOURCE = "ledger.close";

/** A statement can't be produced (e.g. accounts not mapped); the message is safe to show. */
export class FsError extends Error {
  override name = "FsError";
}

export type StatementLine = { code: string; caption: string; section: string; amount: Money; compare?: Money; bySegment?: Record<string, Money> };
export type Statement = { title: string; lines: StatementLine[] };

const POSTED = ["POSTED", "REVERSED"] as const;
type Totals = { debit: Money; credit: Money };

/** Debits and credits per account: up to `to` (from `from` when given), optionally without year-end closing entries. */
async function movements(db: Db | Tx, opts: { from?: BusinessDate; to: BusinessDate; closing: "include" | "exclude" | "only" }): Promise<Map<string, Totals>> {
  const rows = await db
    .select({ accountId: journalLines.accountId, debit: sql<string>`sum(${journalLines.debit})::text`, credit: sql<string>`sum(${journalLines.credit})::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(
      and(
        inArray(journalEntries.status, [...POSTED]),
        lte(journalEntries.entryDate, opts.to),
        opts.from ? gte(journalEntries.entryDate, opts.from) : undefined,
        opts.closing === "exclude" ? ne(journalEntries.sourceModule, CLOSING_SOURCE) : opts.closing === "only" ? eq(journalEntries.sourceModule, CLOSING_SOURCE) : undefined,
      ),
    )
    .groupBy(journalLines.accountId);
  return new Map(rows.map((r) => [r.accountId, { debit: BigInt(r.debit), credit: BigInt(r.credit) }]));
}

const debitSide = (section: FsSection) => section === "ASSETS" || section === "EXPENSE";
const signed = (section: FsSection, t: Totals | undefined) => (t ? (debitSide(section) ? t.debit - t.credit : t.credit - t.debit) : 0n);

type Layout = { lines: FsLine[]; accountsOf: Map<string, string[]>; segmentOf: Map<string, string>; revenueIds: string[]; expenseIds: string[]; segments: Array<{ code: string; name: string }> };

/**
 * The layout, after checking that every postable account is on one line of the right statement
 * (assets, liabilities and equity on the Financial Condition; revenues and expenses on Operations).
 */
export async function layout(db: Db | Tx = getDb()): Promise<Layout> {
  const lines = await db.select().from(fsLines).orderBy(asc(fsLines.sortOrder));
  const all = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type, isPostable: accounts.isPostable }).from(accounts).orderBy(asc(accounts.code));
  const maps = await db.select().from(fsLineAccounts);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const lineOfAccount = new Map(maps.map((m) => [m.accountId, lineById.get(m.fsLineId)]));
  const problems: string[] = [];
  for (const a of all.filter((x) => x.isPostable)) {
    const line = lineOfAccount.get(a.id);
    const wants = ["ASSET", "LIABILITY", "EQUITY"].includes(a.type) ? "SFC" : "SOO";
    if (!line || line.statement !== wants || line.computed) problems.push(`${a.code} ${a.name}`);
  }
  if (problems.length) throw new FsError(`These accounts are not mapped to a statement line yet: ${problems.join(", ")}. Map them under Financial statements › Account mapping.`);
  const accountsOf = new Map<string, string[]>();
  for (const m of maps) accountsOf.set(m.fsLineId, [...(accountsOf.get(m.fsLineId) ?? []), m.accountId]);
  const segRows = await db.select().from(accountSegments);
  const segList = await db.select({ code: segments.code, name: segments.name }).from(segments).orderBy(asc(segments.sortOrder));
  return {
    lines,
    accountsOf,
    segmentOf: new Map(segRows.map((s) => [s.accountId, s.segmentCode])),
    revenueIds: all.filter((a) => a.type === "REVENUE").map((a) => a.id),
    expenseIds: all.filter((a) => a.type === "EXPENSE").map((a) => a.id),
    segments: segList,
  };
}

function lineAmount(l: FsLine, lay: Layout, bal: Map<string, Totals>): Money {
  return (lay.accountsOf.get(l.id) ?? []).reduce((s, id) => s + signed(l.section, bal.get(id)), 0n);
}

/** Revenues − expenses in a set of balances (the year's net surplus while it isn't closed). */
function netSurplusOf(lay: Layout, bal: Map<string, Totals>): Money {
  return lay.revenueIds.reduce((s, id) => s + signed("REVENUE", bal.get(id)), 0n) - lay.expenseIds.reduce((s, id) => s + signed("EXPENSE", bal.get(id)), 0n);
}

const compareInto = (current: StatementLine[], previous: StatementLine[]) => {
  const prev = new Map(previous.map((l) => [l.code, l.amount]));
  for (const l of current) l.compare = prev.get(l.code) ?? 0n;
};

// ── Statement of Financial Condition ──

export type FinancialCondition = Statement & {
  asOf: BusinessDate;
  totals: { assets: Money; liabilities: Money; equity: Money; liabilitiesAndEquity: Money; balanced: boolean };
  compareTotals?: FinancialCondition["totals"];
};

async function sfcOnly(asOf: BusinessDate, lay: Layout, db: Db | Tx): Promise<Omit<FinancialCondition, "compareTotals">> {
  const bal = await movements(db, { to: asOf, closing: "include" });
  const lines: StatementLine[] = lay.lines
    .filter((l) => l.statement === "SFC")
    .map((l) => ({ code: l.code, caption: l.caption, section: l.section, amount: l.computed ? netSurplusOf(lay, bal) : lineAmount(l, lay, bal) }));
  const sum = (section: string) => lines.filter((l) => l.section === section).reduce((s, l) => s + l.amount, 0n);
  const assets = sum("ASSETS");
  const liabilities = sum("LIABILITIES");
  const equity = sum("EQUITY");
  return { title: "Statement of Financial Condition", asOf, lines, totals: { assets, liabilities, equity, liabilitiesAndEquity: liabilities + equity, balanced: assets === liabilities + equity } };
}

/** Assets, liabilities and equity as of a date (the year's unclosed net surplus as its own equity line). */
export async function financialCondition(asOf: BusinessDate, opts: { compareAsOf?: BusinessDate } = {}, db: Db | Tx = getDb()): Promise<FinancialCondition> {
  const lay = await layout(db);
  const current: FinancialCondition = await sfcOnly(asOf, lay, db);
  if (opts.compareAsOf) {
    const prev = await sfcOnly(opts.compareAsOf, lay, db);
    compareInto(current.lines, prev.lines);
    current.compareTotals = prev.totals;
  }
  return current;
}

// ── Statement of Operations ──

type OpsTotals = { revenues: Money; expenses: Money; netSurplus: Money };
export type Operations = Statement & {
  from: BusinessDate;
  to: BusinessDate;
  segments: Array<{ code: string; name: string }>;
  totals: OpsTotals;
  segmentTotals: Record<string, OpsTotals>;
  compareTotals?: OpsTotals;
};

async function sooOnly(from: BusinessDate, to: BusinessDate, lay: Layout, db: Db | Tx): Promise<Omit<Operations, "compareTotals">> {
  const bal = await movements(db, { from, to, closing: "exclude" });
  const segCodes = lay.segments.map((s) => s.code);
  const lines: StatementLine[] = lay.lines
    .filter((l) => l.statement === "SOO")
    .map((l) => {
      const bySegment: Record<string, Money> = Object.fromEntries(segCodes.map((c) => [c, 0n]));
      for (const id of lay.accountsOf.get(l.id) ?? []) {
        const seg = lay.segmentOf.get(id) ?? "GENERAL";
        bySegment[seg] = (bySegment[seg] ?? 0n) + signed(l.section, bal.get(id));
      }
      return { code: l.code, caption: l.caption, section: l.section, amount: Object.values(bySegment).reduce((s, v) => s + v, 0n), bySegment };
    });
  const totalsFor = (pick: (l: StatementLine) => Money): OpsTotals => {
    const revenues = lines.filter((l) => l.section === "REVENUE").reduce((s, l) => s + pick(l), 0n);
    const expenses = lines.filter((l) => l.section === "EXPENSE").reduce((s, l) => s + pick(l), 0n);
    return { revenues, expenses, netSurplus: revenues - expenses };
  };
  return {
    title: "Statement of Operations",
    from,
    to,
    segments: lay.segments,
    lines,
    totals: totalsFor((l) => l.amount),
    segmentTotals: Object.fromEntries(segCodes.map((c) => [c, totalsFor((l) => l.bySegment?.[c] ?? 0n)])),
  };
}

/** Revenues and expenses for a period, by business segment (year-end closing entries left out). */
export async function operations(from: BusinessDate, to: BusinessDate, opts: { compare?: { from: BusinessDate; to: BusinessDate } } = {}, db: Db | Tx = getDb()): Promise<Operations> {
  const lay = await layout(db);
  const current: Operations = await sooOnly(from, to, lay, db);
  if (opts.compare) {
    const prev = await sooOnly(opts.compare.from, opts.compare.to, lay, db);
    compareInto(current.lines, prev.lines);
    current.compareTotals = prev.totals;
  }
  return current;
}

// ── Statement of Changes in Equity ──

export type EquityRow = { code: string; caption: string; opening: Money; netSurplus: Money; transfers: Money; other: Money; closing: Money };
export type ChangesInEquity = { title: string; from: BusinessDate; to: BusinessDate; rows: EquityRow[]; total: EquityRow };

/**
 * Each equity line from the day before the period to its end: the period's net surplus, the
 * year-end transfer of the net surplus into Undivided Net Surplus, and everything else (share
 * capital paid in or withdrawn, the surplus allocation).
 */
export async function changesInEquity(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()): Promise<ChangesInEquity> {
  const lay = await layout(db);
  const [opening, closing, ops, closingMoves] = [await sfcOnly(addDays(from, -1), lay, db), await sfcOnly(to, lay, db), await sooOnly(from, to, lay, db), await movements(db, { from, to, closing: "only" })];
  const at = (s: { lines: StatementLine[] }, code: string) => s.lines.find((l) => l.code === code)?.amount ?? 0n;
  const rows: EquityRow[] = lay.lines
    .filter((l) => l.statement === "SFC" && l.section === "EQUITY")
    .map((l) => {
      const o = at(opening, l.code);
      const c = at(closing, l.code);
      const netSurplus = l.computed ? ops.totals.netSurplus : 0n;
      // The closing entry empties revenues and expenses (the computed line goes down by the net surplus) into Undivided Net Surplus.
      const transfers = l.computed ? netSurplusOf(lay, closingMoves) : lineAmount(l, lay, closingMoves);
      return { code: l.code, caption: l.caption, opening: o, netSurplus, transfers, other: c - o - netSurplus - transfers, closing: c };
    });
  const sum = (k: keyof Omit<EquityRow, "code" | "caption">) => rows.reduce((s, r) => s + r[k], 0n);
  return {
    title: "Statement of Changes in Equity",
    from,
    to,
    rows,
    total: { code: "TOTAL", caption: "Total equity", opening: sum("opening"), netSurplus: sum("netSurplus"), transfers: sum("transfers"), other: sum("other"), closing: sum("closing") },
  };
}

// ── Statement of Cash Flows (indirect) ──

export type CashFlowLine = StatementLine & { activity: Exclude<CashFlowClass, "CASH"> };
export type CashFlows = {
  title: string;
  from: BusinessDate;
  to: BusinessDate;
  lines: CashFlowLine[];
  totals: { operating: Money; investing: Money; financing: Money; netChange: Money; beginningCash: Money; endingCash: Money };
  compareTotals?: CashFlows["totals"];
};

async function cfOnly(from: BusinessDate, to: BusinessDate, lay: Layout, db: Db | Tx): Promise<Omit<CashFlows, "compareTotals">> {
  const ops = await sooOnly(from, to, lay, db);
  const moves = await movements(db, { from, to, closing: "exclude" });
  const lines: CashFlowLine[] = [{ code: "NET_SURPLUS", caption: "Net surplus for the period", section: "OPERATING", activity: "OPERATING", amount: ops.totals.netSurplus }];
  for (const l of lay.lines.filter((x) => x.statement === "SFC" && x.cashFlow && x.cashFlow !== "CASH")) {
    const change = lineAmount(l, lay, moves);
    // An asset that grew used cash; a liability or equity that grew brought it in.
    const amount = l.section === "ASSETS" ? -change : change;
    lines.push({ code: l.code, caption: `Change in ${l.caption.replace(/^Less: /, "").toLowerCase()}`, section: l.cashFlow as string, activity: l.cashFlow as CashFlowLine["activity"], amount });
  }
  const sum = (a: string) => lines.filter((l) => l.activity === a).reduce((s, l) => s + l.amount, 0n);
  const operating = sum("OPERATING");
  const investing = sum("INVESTING");
  const financing = sum("FINANCING");
  const cashLine = lay.lines.find((l) => l.cashFlow === "CASH");
  const cashAt = async (date: BusinessDate) => (cashLine ? lineAmount(cashLine, lay, await movements(db, { to: date, closing: "include" })) : 0n);
  const beginningCash = await cashAt(addDays(from, -1));
  const netChange = operating + investing + financing;
  const endingCash = beginningCash + netChange;
  const glCash = await cashAt(to);
  if (endingCash !== glCash) throw new FsError(`The cash flows don't reconcile with the GL cash (${endingCash} vs ${glCash}); check the cash-flow class of the statement lines`);
  return { title: "Statement of Cash Flows", from, to, lines, totals: { operating, investing, financing, netChange, beginningCash, endingCash } };
}

/** Cash flows for a period by the indirect method: the net surplus adjusted by the change in every non-cash line. */
export async function cashFlows(from: BusinessDate, to: BusinessDate, opts: { compare?: { from: BusinessDate; to: BusinessDate } } = {}, db: Db | Tx = getDb()): Promise<CashFlows> {
  const lay = await layout(db);
  const current: CashFlows = await cfOnly(from, to, lay, db);
  if (opts.compare) {
    const prev = await cfOnly(opts.compare.from, opts.compare.to, lay, db);
    compareInto(current.lines, prev.lines);
    current.compareTotals = prev.totals;
  }
  return current;
}

/** Postable accounts not mapped (or mapped to the wrong statement), for the mapping screen. */
export async function unmappedAccounts(db: Db | Tx = getDb()) {
  try {
    await layout(db);
    return [];
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    const lines = await db.select().from(fsLines);
    const maps = await db.select().from(fsLineAccounts);
    const lineOf = new Map(maps.map((m) => [m.accountId, lines.find((l) => l.id === m.fsLineId)]));
    const all = await db.select().from(accounts).where(eq(accounts.isPostable, true)).orderBy(asc(accounts.code));
    return all.filter((a) => {
      const line = lineOf.get(a.id);
      const wants = ["ASSET", "LIABILITY", "EQUITY"].includes(a.type) ? "SFC" : "SOO";
      return !line || line.statement !== wants || line.computed;
    });
  }
}

// ── Mapping (Financial statements › Account mapping) ──

const SECTION_OF: Record<string, FsSection> = { ASSET: "ASSETS", LIABILITY: "LIABILITIES", EQUITY: "EQUITY", REVENUE: "REVENUE", EXPENSE: "EXPENSE" };
const TYPE_WORD: Record<string, string> = { ASSET: "an asset", LIABILITY: "a liability", EQUITY: "an equity", REVENUE: "a revenue", EXPENSE: "an expense" };
const SECTION_WORD: Record<FsSection, string> = { ASSETS: "Assets", LIABILITIES: "Liabilities", EQUITY: "Equity", REVENUE: "Revenues", EXPENSE: "Expenses" };

/** Puts a postable account on a statement line of the right statement (moving it if it was elsewhere). */
export async function mapAccount(tx: Tx, input: { accountId: string; fsLineId: string }, actorId: string) {
  const [a] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!a || !a.isPostable) throw new FsError("Choose a postable account");
  const [line] = await tx.select().from(fsLines).where(eq(fsLines.id, input.fsLineId));
  if (!line || line.computed) throw new FsError("Choose a statement line");
  const wants = ["ASSET", "LIABILITY", "EQUITY"].includes(a.type) ? "SFC" : "SOO";
  if (line.statement !== wants) throw new FsError(`${a.code} ${a.name} belongs on the ${wants === "SFC" ? "Statement of Financial Condition" : "Statement of Operations"}`);
  // Each line takes its own kind of account; a receivable may also reduce an equity line (subscription receivable on share capital).
  if (SECTION_OF[a.type] !== line.section && !(a.type === "ASSET" && line.section === "EQUITY")) {
    throw new FsError(`${a.code} ${a.name} is ${TYPE_WORD[a.type] ?? "a different kind of"} account; put it on a line under ${SECTION_WORD[SECTION_OF[a.type] ?? line.section]}`);
  }
  const [before] = await tx.select().from(fsLineAccounts).where(eq(fsLineAccounts.accountId, a.id));
  if (before) await tx.update(fsLineAccounts).set({ fsLineId: line.id }).where(eq(fsLineAccounts.id, before.id));
  else await tx.insert(fsLineAccounts).values({ fsLineId: line.id, accountId: a.id, createdBy: actorId });
  await audit(tx, { action: "fs.map", entity: "account", entityId: a.id, before: before ? { fsLineId: before.fsLineId } : null, after: { line: line.code }, userId: actorId });
}

/** The business segment of a revenue or expense account (GENERAL removes the assignment). */
export async function setSegment(tx: Tx, input: { accountId: string; segmentCode: string }, actorId: string) {
  const [a] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!a || (a.type !== "REVENUE" && a.type !== "EXPENSE")) throw new FsError("Only revenue and expense accounts have a segment");
  const [seg] = await tx.select().from(segments).where(eq(segments.code, input.segmentCode));
  if (!seg) throw new FsError("Choose a segment");
  await tx.delete(accountSegments).where(eq(accountSegments.accountId, a.id));
  if (seg.code !== "GENERAL") await tx.insert(accountSegments).values({ accountId: a.id, segmentCode: seg.code, createdBy: actorId });
  await audit(tx, { action: "fs.segment", entity: "account", entityId: a.id, after: { segment: seg.code }, userId: actorId });
}

/** Every statement line with its accounts, and each revenue or expense account's segment (mapping screen). */
export async function mappingView(db: Db | Tx = getDb()) {
  const lines = await db.select().from(fsLines).orderBy(asc(fsLines.sortOrder));
  const rows = await db
    .select({ fsLineId: fsLineAccounts.fsLineId, accountId: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type, segment: accountSegments.segmentCode })
    .from(fsLineAccounts)
    .innerJoin(accounts, eq(accounts.id, fsLineAccounts.accountId))
    .leftJoin(accountSegments, eq(accountSegments.accountId, accounts.id))
    .orderBy(asc(accounts.code));
  const segs = await db.select().from(segments).orderBy(asc(segments.sortOrder));
  return { lines: lines.map((l) => ({ line: l, accounts: rows.filter((r) => r.fsLineId === l.id) })), segments: segs };
}
