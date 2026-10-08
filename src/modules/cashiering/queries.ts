import { aliasedTable, and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import type { BusinessDate } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { accounts, journalEntries } from "@/modules/ledger/schema";
import { members } from "@/modules/members/schema";
import { disbursementVouchers, dvLines, receiptItems, receipts, tellerSessions, type DvStatus, type SessionStatus } from "./schema";

const teller = aliasedTable(users, "teller");

export async function sessionReceipts(sessionId: string, db: Db | Tx = getDb()) {
  return db
    .select({ id: receipts.id, receiptNo: receipts.receiptNo, birReceiptNo: receipts.birReceiptNo, payorName: receipts.payorName, total: receipts.total, mode: receipts.mode, status: receipts.status, createdAt: receipts.createdAt })
    .from(receipts)
    .where(eq(receipts.sessionId, sessionId))
    .orderBy(desc(receipts.createdAt));
}

export async function listSessions(f: { date?: BusinessDate; status?: SessionStatus }, db: Db | Tx = getDb()) {
  const conds: SQL[] = [];
  if (f.date) conds.push(eq(tellerSessions.businessDate, f.date));
  if (f.status) conds.push(eq(tellerSessions.status, f.status));
  const rows = await db
    .select({ session: tellerSessions, tellerUsername: users.username, tellerName: users.name })
    .from(tellerSessions)
    .innerJoin(users, eq(users.id, tellerSessions.tellerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tellerSessions.businessDate), asc(users.username))
    .limit(200);
  const verifierIds = [...new Set(rows.map((r) => r.session.verifiedBy).filter((x): x is string => !!x))];
  const verifiers = verifierIds.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, verifierIds)) : [];
  return rows.map((r) => ({
    ...r.session,
    tellerUsername: r.tellerUsername,
    tellerName: r.tellerName,
    verifiedByName: verifiers.find((v) => v.id === r.session.verifiedBy)?.username ?? null,
  }));
}

export async function getReceipt(receiptId: string, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ receipt: receipts, tellerName: teller.name, tellerUsername: teller.username, tellerId: tellerSessions.tellerId, sessionStatus: tellerSessions.status, jeNo: journalEntries.jeNo })
    .from(receipts)
    .innerJoin(tellerSessions, eq(tellerSessions.id, receipts.sessionId))
    .innerJoin(teller, eq(teller.id, tellerSessions.tellerId))
    .innerJoin(journalEntries, eq(journalEntries.id, receipts.jeId))
    .where(eq(receipts.id, receiptId));
  if (!r) return null;
  const items = await db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId)).orderBy(asc(receiptItems.lineNo));
  return { ...r.receipt, tellerName: r.tellerName, tellerUsername: r.tellerUsername, tellerId: r.tellerId, sessionStatus: r.sessionStatus, jeNo: r.jeNo, items };
}

export async function listDvs(f: { status?: DvStatus }, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ dv: disbursementVouchers, preparedBy: users.username })
    .from(disbursementVouchers)
    .innerJoin(users, eq(users.id, disbursementVouchers.preparedBy))
    .where(f.status ? eq(disbursementVouchers.status, f.status) : undefined)
    .orderBy(desc(disbursementVouchers.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.dv, preparedByName: r.preparedBy }));
}

export async function getDv(dvId: string, db: Db | Tx = getDb()) {
  const [dv] = await db.select().from(disbursementVouchers).where(eq(disbursementVouchers.id, dvId));
  if (!dv) return null;
  const ids = [dv.preparedBy, dv.approvedBy, dv.releasedBy].filter((x): x is string => !!x);
  const people = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids));
  const name = (id: string | null) => people.find((p) => p.id === id)?.username ?? null;
  const lines = await db
    .select({ lineNo: dvLines.lineNo, code: accounts.code, name: accounts.name, memberNo: members.memberNo, amount: dvLines.amount, memo: dvLines.memo })
    .from(dvLines)
    .innerJoin(accounts, eq(accounts.id, dvLines.accountId))
    .leftJoin(members, eq(members.id, dvLines.memberId))
    .where(eq(dvLines.dvId, dvId))
    .orderBy(asc(dvLines.lineNo));
  let jeNo: string | null = null;
  if (dv.jeId) {
    const [je] = await db.select({ jeNo: journalEntries.jeNo }).from(journalEntries).where(eq(journalEntries.id, dv.jeId));
    jeNo = je?.jeNo ?? null;
  }
  return { ...dv, preparedByName: name(dv.preparedBy), approvedByName: name(dv.approvedBy), releasedByName: name(dv.releasedBy), lines, jeNo };
}

/** Count of approved DVs waiting for release (shown on the teller desk). */
export async function approvedDvCount(db: Db | Tx = getDb()) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(disbursementVouchers).where(eq(disbursementVouchers.status, "APPROVED"));
  return r?.n ?? 0;
}
