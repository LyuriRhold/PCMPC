import { and, asc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser, SodError } from "@/lib/auth-guard";
import { now, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { members } from "@/modules/members/schema";
import { waterCustomers } from "@/modules/water/schema";
import { periodKey, periodOf } from "./periods";
import { accountMappings, accounts, journalEntries, journalLines, type Account, type Book, type JournalEntry, type NormalBalance } from "./schema";

/** A posting rule was broken; the message is safe to show. */
export class LedgerError extends Error {
  override name = "LedgerError";
}

export type LineInput = {
  accountId: string;
  debit?: Money;
  credit?: Money;
  memberId?: string | null;
  /** Water customer, required on customer-ledger accounts (AR–Water, Customers' Deposits/Advances). */
  customerId?: string | null;
  memo?: string | null;
};

export type PostJournalInput = {
  date: BusinessDate;
  book: Book;
  particulars: string;
  reference?: string | null;
  /** The business record this entry belongs to (e.g. { module: "share", id: paymentId }). */
  source?: { module: string; id?: string | null };
  lines: LineInput[];
};

const POSTED_STATUSES = ["POSTED", "REVERSED"] as const;

/** Account id for a DOMAIN §6 mapping key. */
export async function accountIdFor(key: string, db: Db | Tx = getDb()): Promise<string> {
  const [m] = await db.select({ accountId: accountMappings.accountId }).from(accountMappings).where(eq(accountMappings.key, key));
  if (!m) throw new LedgerError(`No account is mapped to "${key}"`);
  return m.accountId;
}

const label = (a: Pick<Account, "code" | "name">) => `${a.code} ${a.name}`;

/**
 * Checks a set of lines against every posting rule except the period: amounts, balance,
 * accounts (exist, postable, active) and member subsidiary ledgers. Returns the totals.
 */
async function validateLines(tx: Tx, lines: LineInput[], opts: { allowInactive?: boolean } = {}): Promise<Money> {
  if (lines.length < 2) throw new LedgerError("An entry needs at least two lines");
  let dr = 0n;
  let cr = 0n;
  lines.forEach((l, i) => {
    const d = l.debit ?? 0n;
    const c = l.credit ?? 0n;
    if (d < 0n || c < 0n) throw new LedgerError(`Line ${i + 1}: amounts can't be negative`);
    if ((d > 0n) === (c > 0n)) throw new LedgerError(`Line ${i + 1}: enter either a debit or a credit`);
    dr += d;
    cr += c;
  });
  if (dr !== cr) throw new LedgerError(`Entry is not balanced (${format(dr)} vs ${format(cr)})`);

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const rows = await tx.select().from(accounts).where(inArray(accounts.id, ids));
  const byId = new Map(rows.map((a) => [a.id, a]));
  const flags = await tx
    .select({ accountId: accountMappings.accountId, requiresMember: accountMappings.requiresMember, requiresCustomer: accountMappings.requiresCustomer })
    .from(accountMappings)
    .where(inArray(accountMappings.accountId, ids));
  const subsidiary = new Set(flags.filter((m) => m.requiresMember).map((m) => m.accountId));
  const customerAccounts = new Set(flags.filter((m) => m.requiresCustomer).map((m) => m.accountId));
  const customerIds = [...new Set(lines.map((l) => l.customerId).filter((c): c is string => !!c))];
  const knownCustomers = new Set(
    customerIds.length ? (await tx.select({ id: waterCustomers.id }).from(waterCustomers).where(inArray(waterCustomers.id, customerIds))).map((c) => c.id) : [],
  );
  const memberIds = [...new Set(lines.map((l) => l.memberId).filter((m): m is string => !!m))];
  const knownMembers = new Set(
    memberIds.length ? (await tx.select({ id: members.id }).from(members).where(inArray(members.id, memberIds))).map((m) => m.id) : [],
  );
  lines.forEach((l, i) => {
    const a = byId.get(l.accountId);
    if (!a) throw new LedgerError(`Line ${i + 1}: unknown account`);
    if (!a.isPostable) throw new LedgerError(`Line ${i + 1}: account ${label(a)} is not postable (header account)`);
    if (!a.isActive && !opts.allowInactive) throw new LedgerError(`Line ${i + 1}: account ${label(a)} is inactive`);
    if (subsidiary.has(a.id) && !l.memberId) {
      throw new LedgerError(`Line ${i + 1}: account ${label(a)} is a member subsidiary ledger; choose the member`);
    }
    if (l.memberId && !knownMembers.has(l.memberId)) throw new LedgerError(`Line ${i + 1}: unknown member`);
    if (l.customerId && !knownCustomers.has(l.customerId)) throw new LedgerError(`Line ${i + 1}: unknown water customer`);
    if (customerAccounts.has(a.id) && !l.customerId) {
      throw new LedgerError(`Line ${i + 1}: account ${label(a)} is a customer subsidiary ledger; choose the water customer`);
    }
  });
  return dr;
}

async function assertPeriodOpen(tx: Tx, date: BusinessDate): Promise<void> {
  const p = await periodOf(date, tx);
  if (!p) throw new LedgerError(`Period ${periodKey(date)} is not set up`);
  if (p.status !== "OPEN") throw new LedgerError(`Period ${periodKey(date)} is closed`);
}

async function insertLines(tx: Tx, jeId: string, lines: LineInput[], actorId: string | null): Promise<void> {
  await tx.insert(journalLines).values(
    lines.map((l, i) => ({
      jeId,
      lineNo: i + 1,
      accountId: l.accountId,
      memberId: l.memberId ?? null,
      customerId: l.customerId ?? null,
      debit: l.debit ?? 0n,
      credit: l.credit ?? 0n,
      memo: l.memo ?? null,
      createdBy: actorId,
    })),
  );
}

/**
 * The single door to the general ledger. Validates the entry, assigns the next gapless number of
 * its book and posts it, inside the caller's transaction so the business record and its entry
 * commit or roll back together.
 */
export async function postJournal(tx: Tx, input: PostJournalInput, actorId: string | null, opts: { reversalOfId?: string; allowInactive?: boolean } = {}): Promise<JournalEntry> {
  const particulars = input.particulars.trim();
  if (!particulars) throw new LedgerError("Particulars are required");
  const total = await validateLines(tx, input.lines, { allowInactive: opts.allowInactive });
  await assertPeriodOpen(tx, input.date);

  const jeNo = await nextNumber(input.book, tx, input.date);
  const at = now();
  const [je] = await tx
    .insert(journalEntries)
    .values({
      jeNo,
      book: input.book,
      entryDate: input.date,
      reference: input.reference ?? null,
      particulars,
      sourceModule: input.source?.module ?? "ledger",
      sourceId: input.source?.id ?? null,
      status: "POSTED",
      preparedBy: actorId,
      postedAt: at,
      reversalOfId: opts.reversalOfId ?? null,
      createdBy: actorId,
      createdAt: at,
    })
    .returning();
  if (!je) throw new Error("journal entry insert returned no row");
  await insertLines(tx, je.id, input.lines, actorId);
  await audit(tx, {
    action: "je.post",
    entity: "journal_entry",
    entityId: je.id,
    after: { jeNo, book: je.book, date: je.entryDate, total, source: je.sourceModule, sourceId: je.sourceId },
    userId: actorId,
  });
  return je;
}

/**
 * Reverses a posted entry: posts a mirror entry (same book, debits and credits swapped, linked by
 * reversal_of_id) dated `date`, and marks the original REVERSED. An entry is reversed at most once.
 */
export async function reverseJournal(tx: Tx, jeId: string, date: BusinessDate, reason: string, actorId: string | null): Promise<JournalEntry> {
  const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.id, jeId)).for("update");
  if (!orig) throw new LedgerError("Journal entry not found");
  if (orig.status === "DRAFT") throw new LedgerError("A draft isn't posted; discard it instead of reversing");
  if (orig.status === "REVERSED") throw new LedgerError(`${orig.jeNo} is already reversed`);
  if (orig.reversalOfId) throw new LedgerError(`${orig.jeNo} is itself a reversal and can't be reversed`);
  if (!reason.trim()) throw new LedgerError("A reason is required");

  const lines = await tx.select().from(journalLines).where(eq(journalLines.jeId, jeId)).orderBy(asc(journalLines.lineNo));
  const rev = await postJournal(
    tx,
    {
      date,
      book: orig.book,
      particulars: `Reversal of ${orig.jeNo}: ${reason.trim()}`,
      reference: orig.jeNo,
      source: { module: orig.sourceModule, id: orig.sourceId },
      lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memberId: l.memberId, customerId: l.customerId, memo: l.memo })),
    },
    actorId,
    { reversalOfId: orig.id, allowInactive: true },
  );
  await tx.update(journalEntries).set({ status: "REVERSED", reversedById: rev.id }).where(eq(journalEntries.id, orig.id));
  await audit(tx, { action: "je.reverse", entity: "journal_entry", entityId: orig.id, after: { jeNo: orig.jeNo, reversalJeNo: rev.jeNo, reason }, userId: actorId });
  return rev;
}

/**
 * A reversal requested by a person (Journal vouchers screen): same as reverseJournal, but the
 * user who prepared the entry can't reverse it (segregation of duties, reviewer follow-up).
 */
export async function reverseEntryByUser(tx: Tx, jeId: string, date: BusinessDate, reason: string, userId: string): Promise<JournalEntry> {
  const [je] = await tx
    .select({ preparedBy: journalEntries.preparedBy, status: journalEntries.status, reversalOfId: journalEntries.reversalOfId })
    .from(journalEntries)
    .where(eq(journalEntries.id, jeId));
  // Entries that can't be reversed at all get reverseJournal's specific message first.
  if (je?.status === "POSTED" && !je.reversalOfId && je.preparedBy === userId) {
    throw new SodError("Segregation of duties: the preparer of an entry can't reverse it");
  }
  return reverseJournal(tx, jeId, date, reason, userId);
}

// ── Manual journal vouchers (draft → approve → post) ─────────────────────────────────────────

export type DraftInput = { date: BusinessDate; particulars: string; reference: string | null; lines: LineInput[] };

/** Saves a manual JV as a DRAFT (General Journal). It gets its JV number only when approved. */
export async function createJvDraft(tx: Tx, input: DraftInput, preparerId: string): Promise<JournalEntry> {
  const particulars = input.particulars.trim();
  if (!particulars) throw new LedgerError("Particulars are required");
  await validateLines(tx, input.lines);
  const [je] = await tx
    .insert(journalEntries)
    .values({
      jeNo: null,
      book: "GJ",
      entryDate: input.date,
      reference: input.reference,
      particulars,
      sourceModule: "manual_jv",
      status: "DRAFT",
      preparedBy: preparerId,
      createdBy: preparerId,
    })
    .returning();
  if (!je) throw new Error("journal entry insert returned no row");
  await insertLines(tx, je.id, input.lines, preparerId);
  await audit(tx, { action: "jv.draft", entity: "journal_entry", entityId: je.id, after: { date: je.entryDate, particulars }, userId: preparerId });
  return je;
}

/** Approves and posts a draft JV. The approver must not be the preparer (segregation of duties). */
export async function approveJv(tx: Tx, jeId: string, approverId: string): Promise<JournalEntry> {
  const [je] = await tx.select().from(journalEntries).where(eq(journalEntries.id, jeId)).for("update");
  if (!je) throw new LedgerError("Journal voucher not found");
  if (je.status !== "DRAFT") throw new LedgerError(`This JV is already ${je.status}`);
  assertNotSameUser(je.preparedBy ?? "", approverId);
  const lines = await tx.select().from(journalLines).where(eq(journalLines.jeId, jeId)).orderBy(asc(journalLines.lineNo));
  const total = await validateLines(
    tx,
    lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memberId: l.memberId, customerId: l.customerId })),
  );
  await assertPeriodOpen(tx, je.entryDate);
  const jeNo = await nextNumber(je.book, tx, je.entryDate);
  const [posted] = await tx
    .update(journalEntries)
    .set({ status: "POSTED", jeNo, approvedBy: approverId, postedAt: now() })
    .where(eq(journalEntries.id, jeId))
    .returning();
  if (!posted) throw new Error("journal entry update returned no row");
  await audit(tx, { action: "jv.approve", entity: "journal_entry", entityId: jeId, after: { jeNo, total, preparedBy: je.preparedBy }, userId: approverId });
  return posted;
}

/** Deletes a draft JV (drafts are not posted, so nothing in the books changes). */
export async function discardJvDraft(tx: Tx, jeId: string, actorId: string): Promise<void> {
  const [je] = await tx.select().from(journalEntries).where(eq(journalEntries.id, jeId)).for("update");
  if (!je) throw new LedgerError("Journal voucher not found");
  if (je.status !== "DRAFT") throw new LedgerError("Only drafts can be discarded; reverse a posted entry instead");
  await tx.delete(journalLines).where(eq(journalLines.jeId, jeId));
  await tx.delete(journalEntries).where(eq(journalEntries.id, jeId));
  await audit(tx, { action: "jv.discard", entity: "journal_entry", entityId: jeId, before: { particulars: je.particulars, date: je.entryDate }, userId: actorId });
}

// ── Balances and reports ─────────────────────────────────────────────────────────────────────

const sumDr = sql<string>`coalesce(sum(${journalLines.debit}), 0)::text`;
const sumCr = sql<string>`coalesce(sum(${journalLines.credit}), 0)::text`;
const posted = inArray(journalEntries.status, [...POSTED_STATUSES]);

/** Signed balance in the account's normal-balance direction. */
function signed(side: NormalBalance, dr: Money, cr: Money): Money {
  return side === "DR" ? dr - cr : cr - dr;
}

export async function accountBalance(accountId: string, asOf: BusinessDate, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ dr: sumDr, cr: sumCr })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(eq(journalLines.accountId, accountId), posted, lte(journalEntries.entryDate, asOf)));
  const debit = BigInt(r?.dr ?? "0");
  const credit = BigInt(r?.cr ?? "0");
  return { debit, credit, net: debit - credit };
}

export type TbRow = { accountId: string; code: string; name: string; type: string; provisional: boolean; debit: Money; credit: Money };

/** Trial balance as of a date: each account's net balance on its debit or credit side. */
export async function trialBalance(asOf: BusinessDate, db: Db | Tx = getDb()) {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      provisional: accounts.provisional,
      dr: sumDr,
      cr: sumCr,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(posted, lte(journalEntries.entryDate, asOf)))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.code));
  const out: TbRow[] = rows.map((r) => {
    const net = BigInt(r.dr) - BigInt(r.cr);
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      type: r.type,
      provisional: r.provisional,
      debit: net > 0n ? net : 0n,
      credit: net < 0n ? -net : 0n,
    };
  });
  const totalDebit = out.reduce((s, r) => s + r.debit, 0n);
  const totalCredit = out.reduce((s, r) => s + r.credit, 0n);
  return { asOf, rows: out, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export type LedgerLine = {
  jeId: string;
  date: BusinessDate;
  jeNo: string | null;
  book: string;
  particulars: string;
  reference: string | null;
  memberNo: string | null;
  memo: string | null;
  debit: Money;
  credit: Money;
  running: Money;
};

async function ledgerFor(conds: SQL[], side: NormalBalance, from: BusinessDate, to: BusinessDate, db: Db | Tx) {
  const [open] = await db
    .select({ dr: sumDr, cr: sumCr })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(...conds, posted, lt(journalEntries.entryDate, from)));
  const opening = signed(side, BigInt(open?.dr ?? "0"), BigInt(open?.cr ?? "0"));
  const rows = await db
    .select({
      jeId: journalEntries.id,
      date: journalEntries.entryDate,
      jeNo: journalEntries.jeNo,
      book: journalEntries.book,
      particulars: journalEntries.particulars,
      reference: journalEntries.reference,
      memberNo: members.memberNo,
      memo: journalLines.memo,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .leftJoin(members, eq(members.id, journalLines.memberId))
    .where(and(...conds, posted, gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.postedAt), asc(journalEntries.jeNo), asc(journalLines.lineNo));
  let running = opening;
  const lines: LedgerLine[] = rows.map((r) => {
    running += signed(side, r.debit, r.credit);
    return { ...r, running };
  });
  return { opening, lines, closing: running, side };
}

async function accountOrThrow(accountId: string, db: Db | Tx): Promise<Account> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a) throw new LedgerError("Account not found");
  return a;
}

/** General ledger for one account: opening balance, lines in range with running balance, closing. */
export async function generalLedger(accountId: string, from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const account = await accountOrThrow(accountId, db);
  return { account, ...(await ledgerFor([eq(journalLines.accountId, accountId)], account.normalBalance, from, to, db)) };
}

/** Subsidiary ledger of one member on the account mapped to `mappingKey` (e.g. savings_deposits). */
export async function subsidiaryLedger(mappingKey: string, memberId: string, from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const account = await accountOrThrow(await accountIdFor(mappingKey, db), db);
  const ledger = await ledgerFor([eq(journalLines.accountId, account.id), eq(journalLines.memberId, memberId)], account.normalBalance, from, to, db);
  return { account, mappingKey, ...ledger };
}

/** Subsidiary ledger of one water customer on the account mapped to `mappingKey` (e.g. customers_deposits). */
export async function customerLedger(mappingKey: string, customerId: string, from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const account = await accountOrThrow(await accountIdFor(mappingKey, db), db);
  const ledger = await ledgerFor([eq(journalLines.accountId, account.id), eq(journalLines.customerId, customerId)], account.normalBalance, from, to, db);
  return { account, mappingKey, ...ledger };
}

/** Posted entries of one book in a date range, with their lines (journal books listing). */
export async function journalBook(book: Book, from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const entries = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.book, book), posted, gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.jeNo));
  if (entries.length === 0) return [];
  const lines = await db
    .select({
      jeId: journalLines.jeId,
      lineNo: journalLines.lineNo,
      code: accounts.code,
      name: accounts.name,
      memberNo: members.memberNo,
      debit: journalLines.debit,
      credit: journalLines.credit,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(members, eq(members.id, journalLines.memberId))
    .where(inArray(journalLines.jeId, entries.map((e) => e.id)))
    .orderBy(asc(journalLines.lineNo));
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.jeId === e.id) }));
}
