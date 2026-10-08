import { aliasedTable, and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import type { BusinessDate } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { members } from "@/modules/members/schema";
import { accountMappings, accounts, journalEntries, journalLines, type Book, type JeStatus } from "./schema";

export type EntryFilters = { status?: JeStatus; book?: Book; from?: BusinessDate; to?: BusinessDate; q?: string; page?: number };

const preparer = aliasedTable(users, "preparer");
const approver = aliasedTable(users, "approver");

/** Journal entries for the JV list: newest first, with their total and who prepared/approved them. */
export async function listEntries(f: EntryFilters, db: Db | Tx = getDb()) {
  const conds: SQL[] = [];
  if (f.status) conds.push(eq(journalEntries.status, f.status));
  if (f.book) conds.push(eq(journalEntries.book, f.book));
  if (f.from) conds.push(gte(journalEntries.entryDate, f.from));
  if (f.to) conds.push(lte(journalEntries.entryDate, f.to));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conds.push(sql`(${ilike(journalEntries.particulars, like)} OR ${ilike(journalEntries.jeNo, like)} OR ${ilike(journalEntries.reference, like)})`);
  }
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = 50;
  const page = Math.max(f.page ?? 1, 1);
  const total = sql<string>`(SELECT coalesce(sum(${journalLines.debit}), 0)::text FROM ${journalLines} WHERE ${journalLines.jeId} = ${journalEntries.id})`;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: journalEntries.id,
        jeNo: journalEntries.jeNo,
        book: journalEntries.book,
        entryDate: journalEntries.entryDate,
        particulars: journalEntries.particulars,
        reference: journalEntries.reference,
        status: journalEntries.status,
        sourceModule: journalEntries.sourceModule,
        total,
        preparedBy: preparer.username,
        approvedBy: approver.username,
      })
      .from(journalEntries)
      .leftJoin(preparer, eq(preparer.id, journalEntries.preparedBy))
      .leftJoin(approver, eq(approver.id, journalEntries.approvedBy))
      .where(where)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, total: BigInt(r.total) })), total: count?.n ?? 0, page, pageSize };
}

/** One entry with its lines, preparer/approver and the linked reversal entries. */
export async function getEntry(jeId: string, db: Db | Tx = getDb()) {
  const [je] = await db
    .select({
      entry: journalEntries,
      preparedByName: preparer.username,
      approvedByName: approver.username,
    })
    .from(journalEntries)
    .leftJoin(preparer, eq(preparer.id, journalEntries.preparedBy))
    .leftJoin(approver, eq(approver.id, journalEntries.approvedBy))
    .where(eq(journalEntries.id, jeId));
  if (!je) return null;
  const lines = await db
    .select({
      lineNo: journalLines.lineNo,
      accountId: journalLines.accountId,
      code: accounts.code,
      name: accounts.name,
      memberNo: members.memberNo,
      memberName: sql<string | null>`${members.lastName} || ', ' || ${members.firstName}`,
      debit: journalLines.debit,
      credit: journalLines.credit,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(members, eq(members.id, journalLines.memberId))
    .where(eq(journalLines.jeId, jeId))
    .orderBy(asc(journalLines.lineNo));
  const link = async (id: string | null) =>
    id ? ((await db.select({ id: journalEntries.id, jeNo: journalEntries.jeNo }).from(journalEntries).where(eq(journalEntries.id, id)))[0] ?? null) : null;
  return {
    ...je.entry,
    preparedByName: je.preparedByName,
    approvedByName: je.approvedByName,
    lines,
    reversalOf: await link(je.entry.reversalOfId),
    reversedBy: await link(je.entry.reversedById),
  };
}

/** Active postable accounts for pickers (code order), flagged when lines need a member. */
export async function postableAccounts(db: Db | Tx = getDb()) {
  const [rows, memberLedgers] = await Promise.all([
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.isPostable, true), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.code)),
    db.select({ accountId: accountMappings.accountId }).from(accountMappings).where(eq(accountMappings.requiresMember, true)),
  ]);
  const needsMember = new Set(memberLedgers.map((m) => m.accountId));
  return rows.map((r) => ({ ...r, requiresMember: needsMember.has(r.id) }));
}
