import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { businessToday, formatDate, now, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { accounts } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, reverseJournal, type LineInput } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import { CashieringError } from "./builtins";
import { payorType, receiptItem, type ItemInput, type Payor, type ReceiptContext } from "./registry";
import {
  cashCounts,
  cashOuts,
  disbursementVouchers,
  dvLines,
  receiptItems,
  receipts,
  tellerSessions,
  type DisbursementVoucher,
  type DvMode,
  type Receipt,
  type ReceiptMode,
  type TellerSession,
} from "./schema";

export { CashieringError };

const DRAWER_MODES: readonly ReceiptMode[] = ["CASH", "CHECK"];

// ── Sessions (T4.3) ─────────────────────────────────────────────────────────────────────────

/** Opens today's session for a teller. One OPEN session per teller at a time. */
export async function openSession(tx: Tx, tellerId: string, openingCash: Money): Promise<TellerSession> {
  if (openingCash < 0n) throw new CashieringError("Opening cash can't be negative");
  const today = businessToday();
  const [open] = await tx.select().from(tellerSessions).where(and(eq(tellerSessions.tellerId, tellerId), eq(tellerSessions.status, "OPEN")));
  if (open) {
    throw new CashieringError(
      open.businessDate === today
        ? "You already have an open session today"
        : `Your session from ${formatDate(open.businessDate)} is still open; close it first`,
    );
  }
  const [s] = await tx.insert(tellerSessions).values({ tellerId, businessDate: today, openingCash, createdBy: tellerId }).returning();
  if (!s) throw new Error("session insert returned no row");
  await audit(tx, { action: "cash.session_open", entity: "teller_session", entityId: s.id, after: { businessDate: today, openingCash }, userId: tellerId });
  return s;
}

/**
 * The teller's OPEN session for today, locked for the transaction. Every cash movement goes
 * through here, so a closed (or stale) session takes no new transactions.
 */
export async function requireOpenSession(tx: Tx, tellerId: string): Promise<TellerSession> {
  const today = businessToday();
  const [open] = await tx
    .select()
    .from(tellerSessions)
    .where(and(eq(tellerSessions.tellerId, tellerId), eq(tellerSessions.status, "OPEN")))
    .for("update");
  if (open && open.businessDate === today) return open;
  if (open) throw new CashieringError(`Your open session is from ${formatDate(open.businessDate)}; close it and open today's session`);
  const [todays] = await tx.select({ id: tellerSessions.id }).from(tellerSessions).where(and(eq(tellerSessions.tellerId, tellerId), eq(tellerSessions.businessDate, today)));
  if (todays) throw new CashieringError("Your teller session for today is closed");
  throw new CashieringError("Open a teller session first");
}

/** The teller's current session (any status) for today, or the stale open one. */
export async function currentSession(tellerId: string, db: Db | Tx = getDb()): Promise<TellerSession | null> {
  const [open] = await db.select().from(tellerSessions).where(and(eq(tellerSessions.tellerId, tellerId), eq(tellerSessions.status, "OPEN")));
  if (open) return open;
  const [todays] = await db
    .select()
    .from(tellerSessions)
    .where(and(eq(tellerSessions.tellerId, tellerId), eq(tellerSessions.businessDate, businessToday())))
    .orderBy(sql`${tellerSessions.createdAt} DESC`)
    .limit(1);
  return todays ?? null;
}

/** Cash taken in (cash and checks), cash paid out, and the expected drawer cash of a session. */
export async function sessionTotals(sessionId: string, db: Db | Tx = getDb()) {
  const [s] = await db.select().from(tellerSessions).where(eq(tellerSessions.id, sessionId));
  if (!s) throw new CashieringError("Session not found");
  const [rIn] = await db
    .select({ n: sql<string>`coalesce(sum(${receipts.total}), 0)::text`, c: sql<number>`count(*)::int` })
    .from(receipts)
    .where(and(eq(receipts.sessionId, sessionId), eq(receipts.status, "VALID"), inArray(receipts.mode, [...DRAWER_MODES])));
  const [rOut] = await db
    .select({ n: sql<string>`coalesce(sum(${cashOuts.amount}), 0)::text`, c: sql<number>`count(*)::int` })
    .from(cashOuts)
    .where(eq(cashOuts.sessionId, sessionId));
  const receiptsIn = BigInt(rIn?.n ?? "0");
  const cashOut = BigInt(rOut?.n ?? "0");
  return { session: s, receiptsIn, receiptCount: rIn?.c ?? 0, cashOut, cashOutCount: rOut?.c ?? 0, expected: s.openingCash + receiptsIn - cashOut };
}

export type CountInput = { denomination: Money; kind: "BILL" | "COIN"; qty: number };

/** Closes the teller's session with a cash count. Expected = opening + cash receipts − cash-outs. */
export async function closeSession(tx: Tx, sessionId: string, counts: CountInput[], tellerId: string): Promise<TellerSession> {
  const [s] = await tx.select().from(tellerSessions).where(eq(tellerSessions.id, sessionId)).for("update");
  if (!s) throw new CashieringError("Session not found");
  if (s.tellerId !== tellerId) throw new CashieringError("Only the teller who opened the session can close it");
  if (s.status !== "OPEN") throw new CashieringError(`This session is already ${s.status}`);
  const allowed = await getSetting("cash.denominations", tx);
  const seen = new Set<string>();
  for (const c of counts) {
    const key = `${c.denomination}:${c.kind}`;
    if (!allowed.some((d) => BigInt(d.value) === c.denomination && d.kind === c.kind)) {
      throw new CashieringError(`${format(c.denomination)} ${c.kind.toLowerCase()} is not a counted denomination`);
    }
    if (seen.has(key)) throw new CashieringError(`${format(c.denomination)} ${c.kind.toLowerCase()} is counted twice`);
    if (!Number.isInteger(c.qty) || c.qty < 0) throw new CashieringError("Quantities must be whole numbers");
    seen.add(key);
  }
  const counted = counts.reduce((sum, c) => sum + c.denomination * BigInt(c.qty), 0n);
  const { expected } = await sessionTotals(sessionId, tx);
  const variance = counted - expected;
  if (counts.length) {
    await tx.insert(cashCounts).values(counts.map((c) => ({ sessionId, denomination: c.denomination, kind: c.kind, qty: c.qty, createdBy: tellerId })));
  }
  const [closed] = await tx
    .update(tellerSessions)
    .set({ status: "CLOSED", expectedCash: expected, countedCash: counted, variance, closedAt: now() })
    .where(eq(tellerSessions.id, sessionId))
    .returning();
  if (!closed) throw new Error("session update returned no row");
  await audit(tx, { action: "cash.session_close", entity: "teller_session", entityId: sessionId, after: { expected, counted, variance }, userId: tellerId });
  return closed;
}

/**
 * Manager verification of a closed session. A variance is posted to Cash Short/Over (short: Dr
 * Short/Over / Cr Cash; over: Dr Cash / Cr Short/Over) on the session's business date.
 */
export async function verifySession(tx: Tx, sessionId: string, managerId: string): Promise<TellerSession> {
  const [s] = await tx.select().from(tellerSessions).where(eq(tellerSessions.id, sessionId)).for("update");
  if (!s) throw new CashieringError("Session not found");
  if (s.status !== "CLOSED") throw new CashieringError(s.status === "OPEN" ? "The teller must close the session first" : "This session is already verified");
  assertNotSameUser(s.tellerId, managerId);
  const variance = s.variance ?? 0n;
  let varianceJeId: string | null = null;
  if (variance !== 0n) {
    const [cash, shortOver] = await Promise.all([accountIdFor("cash_on_hand", tx), accountIdFor("cash_short_over", tx)]);
    const abs = variance < 0n ? -variance : variance;
    const je = await postJournal(
      tx,
      {
        date: s.businessDate,
        book: "GJ",
        particulars: `Cash ${variance < 0n ? "short" : "over"} of teller session ${formatDate(s.businessDate)}`,
        source: { module: "cashiering.session", id: s.id },
        lines:
          variance < 0n
            ? [
                { accountId: shortOver, debit: abs },
                { accountId: cash, credit: abs },
              ]
            : [
                { accountId: cash, debit: abs },
                { accountId: shortOver, credit: abs },
              ],
      },
      managerId,
    );
    varianceJeId = je.id;
  }
  const [verified] = await tx
    .update(tellerSessions)
    .set({ status: "VERIFIED", verifiedBy: managerId, verifiedAt: now(), varianceJeId })
    .where(eq(tellerSessions.id, sessionId))
    .returning();
  if (!verified) throw new Error("session update returned no row");
  await audit(tx, { action: "cash.session_verify", entity: "teller_session", entityId: sessionId, after: { variance, varianceJeId }, userId: managerId });
  return verified;
}

// ── Receipts (T4.4) ─────────────────────────────────────────────────────────────────────────

export type IssueReceiptInput = {
  payor: Payor;
  mode: ReceiptMode;
  checkNo: string | null;
  birReceiptNo: string | null;
  items: ItemInput[];
};

/**
 * Issues one receipt covering many registered items: one CRJ entry (Dr Cash for the total, plus
 * each item's credit lines) and every item's sub-ledger effects, all in this transaction. If any
 * item fails, nothing is saved and the receipt number is not used.
 */
export async function issueReceipt(tx: Tx, input: IssueReceiptInput, tellerId: string): Promise<Receipt> {
  const session = await requireOpenSession(tx, tellerId);
  const birReceiptNo = input.birReceiptNo?.trim() || null;
  if (!birReceiptNo && (await getSetting("cash.require_bir_receipt_no", tx))) throw new CashieringError("Enter the BIR receipt no. for this receipt");
  if (input.items.length === 0) throw new CashieringError("Add at least one item");
  if (input.mode === "CHECK" && !input.checkNo?.trim()) throw new CashieringError("Enter the check number");

  const pt = payorType(input.payor.type);
  if (!pt) throw new CashieringError(`Unknown payor type ${input.payor.type}`);
  let payor: Payor;
  if (pt.freeText) {
    const name = input.payor.name.trim();
    if (!name) throw new CashieringError("Enter the payor's name");
    payor = { type: pt.type, id: null, name };
  } else {
    const found = input.payor.id && pt.get ? await pt.get(tx, input.payor.id) : null;
    if (!found) throw new CashieringError(`${pt.label} not found`);
    payor = { type: pt.type, id: found.id, name: found.name };
  }

  const date = businessToday();
  const receiptId = randomUUID();
  const receiptNo = await nextNumber("AR", tx, date);
  const ctx: ReceiptContext = { receiptId, receiptNo, date, payor, actorId: tellerId, sessionId: session.id };

  const credits: LineInput[] = [];
  const stored: Array<{ type: string; refId: string | null; description: string; amount: Money; breakdown: unknown }> = [];
  let total = 0n;
  for (const [i, item] of input.items.entries()) {
    const def = receiptItem(item.type);
    if (!def) throw new CashieringError(`Item ${i + 1}: unknown item type ${item.type}`);
    if (item.amount <= 0n) throw new CashieringError(`Item ${i + 1}: the amount must be more than zero`);
    await def.validate(tx, item, ctx);
    const res = await def.apply(tx, item, ctx);
    const credited = res.creditLines.reduce((s, l) => s + (l.credit ?? 0n) - (l.debit ?? 0n), 0n);
    if (credited !== item.amount) throw new Error(`${item.type}: credit lines (${format(credited)}) don't match the item amount (${format(item.amount)})`);
    credits.push(...res.creditLines);
    stored.push({ type: item.type, refId: res.refId ?? item.refId, description: res.description, amount: item.amount, breakdown: res.breakdown ?? null });
    total += item.amount;
  }

  const cashKey = input.mode === "BANK_TRANSFER" ? "cash_in_bank" : "cash_on_hand";
  const je = await postJournal(
    tx,
    {
      date,
      book: "CRJ",
      particulars: `Receipt ${receiptNo} · ${payor.name}`,
      reference: birReceiptNo ?? receiptNo,
      source: { module: "cashiering", id: receiptId },
      lines: [{ accountId: await accountIdFor(cashKey, tx), debit: total }, ...credits],
    },
    tellerId,
  );
  const [receipt] = await tx
    .insert(receipts)
    .values({
      id: receiptId,
      receiptNo,
      birReceiptNo,
      sessionId: session.id,
      payorType: payor.type,
      payorId: payor.id,
      payorName: payor.name,
      receiptDate: date,
      total,
      mode: input.mode,
      checkNo: input.checkNo?.trim() || null,
      jeId: je.id,
      createdBy: tellerId,
    })
    .returning();
  if (!receipt) throw new Error("receipt insert returned no row");
  await tx.insert(receiptItems).values(stored.map((s, i) => ({ receiptId, lineNo: i + 1, ...s, createdBy: tellerId })));
  await audit(tx, {
    action: "receipt.issue",
    entity: "receipt",
    entityId: receiptId,
    after: { receiptNo, birReceiptNo, payor: payor.name, total, mode: input.mode, items: stored.map((s) => ({ type: s.type, refId: s.refId, amount: s.amount })) },
    userId: tellerId,
  });
  return receipt;
}

/**
 * Cancels a receipt on the day it was issued, by a supervisor other than the teller: each item's
 * sub-ledger effects are undone and the receipt's entry is reversed. The number stays used.
 */
export async function cancelReceipt(tx: Tx, receiptId: string, reason: string, supervisorId: string): Promise<Receipt> {
  const [r] = await tx.select().from(receipts).where(eq(receipts.id, receiptId)).for("update");
  if (!r) throw new CashieringError("Receipt not found");
  if (r.status !== "VALID") throw new CashieringError(`Receipt ${r.receiptNo} is already cancelled`);
  const today = businessToday();
  if (r.receiptDate !== today) throw new CashieringError(`Only receipts from the same business day can be cancelled (this one is from ${formatDate(r.receiptDate)})`);
  const [s] = await tx.select().from(tellerSessions).where(eq(tellerSessions.id, r.sessionId)).for("update");
  if (!s) throw new Error("receipt session missing");
  assertNotSameUser(s.tellerId, supervisorId);
  if (s.status !== "OPEN") throw new CashieringError("The teller's session is already closed; the receipt can't be cancelled");
  if (!reason.trim()) throw new CashieringError("A reason is required");
  // Cancelling a cash or check receipt takes its amount out of the expected drawer cash; if that
  // cash was already deposited or paid out, the drawer can't cover the cancellation.
  if (DRAWER_MODES.includes(r.mode)) {
    const { expected } = await sessionTotals(r.sessionId, tx);
    if (expected - r.total < 0n) {
      throw new CashieringError(`Cancelling would leave the drawer short: only ${format(expected)} is expected in the drawer`);
    }
  }

  const items = await tx.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId)).orderBy(asc(receiptItems.lineNo));
  const ctx: ReceiptContext = {
    receiptId,
    receiptNo: r.receiptNo,
    date: today,
    payor: { type: r.payorType, id: r.payorId, name: r.payorName },
    actorId: supervisorId,
    sessionId: r.sessionId,
  };
  for (const item of [...items].reverse()) {
    const def = receiptItem(item.type);
    if (!def) throw new Error(`receipt item type ${item.type} is no longer registered`);
    await def.reverse(tx, { id: item.id, type: item.type, refId: item.refId, amount: item.amount, breakdown: item.breakdown }, ctx);
  }
  const rev = await reverseJournal(tx, r.jeId, today, `Receipt ${r.receiptNo} cancelled: ${reason.trim()}`, supervisorId);
  const [cancelled] = await tx
    .update(receipts)
    .set({ status: "CANCELLED", cancelJeId: rev.id, cancelReason: reason.trim(), cancelledBy: supervisorId, cancelledAt: now() })
    .where(eq(receipts.id, receiptId))
    .returning();
  if (!cancelled) throw new Error("receipt update returned no row");
  await audit(tx, { action: "receipt.cancel", entity: "receipt", entityId: receiptId, after: { receiptNo: r.receiptNo, reason: reason.trim() }, userId: supervisorId });
  return cancelled;
}

// ── Cash-outs, DVs and bank deposits (T4.5) ─────────────────────────────────────────────────

async function assertDrawerHas(tx: Tx, sessionId: string, amount: Money): Promise<void> {
  const { expected } = await sessionTotals(sessionId, tx);
  if (amount > expected) throw new CashieringError(`Not enough cash in the drawer (${format(expected)} available)`);
}

async function recordCashOut(tx: Tx, input: { sessionId: string; type: string; refId: string | null; reference: string | null; amount: Money; jeId: string; date: BusinessDate }, actorId: string) {
  await tx.insert(cashOuts).values({
    sessionId: input.sessionId,
    type: input.type,
    refId: input.refId,
    reference: input.reference,
    amount: input.amount,
    outDate: input.date,
    jeId: input.jeId,
    createdBy: actorId,
  });
}

export type DvLineInput = { accountId: string; memberId: string | null; customerId?: string | null; amount: Money; memo: string | null };
export type CreateDvInput = { date: BusinessDate; payee: string; particulars: string; mode: DvMode; checkNo: string | null; lines: DvLineInput[] };

/** Prepares a disbursement voucher (DRAFT). It gets its DV number now; cancelled DVs keep theirs. */
export async function createDv(tx: Tx, input: CreateDvInput, preparerId: string): Promise<DisbursementVoucher> {
  if (!input.payee.trim()) throw new CashieringError("Payee is required");
  if (!input.particulars.trim()) throw new CashieringError("Particulars are required");
  if (input.lines.length === 0) throw new CashieringError("Add at least one account line");
  if (input.mode === "CHECK" && !input.checkNo?.trim()) throw new CashieringError("Enter the check number");
  const ids = [...new Set(input.lines.map((l) => l.accountId))];
  const found = await tx.select().from(accounts).where(inArray(accounts.id, ids));
  input.lines.forEach((l, i) => {
    if (l.amount <= 0n) throw new CashieringError(`Line ${i + 1}: the amount must be more than zero`);
    const a = found.find((x) => x.id === l.accountId);
    if (!a || !a.isPostable || !a.isActive) throw new CashieringError(`Line ${i + 1}: choose an active postable account`);
  });
  const amount = input.lines.reduce((s, l) => s + l.amount, 0n);
  const dvNo = await nextNumber("DV", tx, input.date);
  const [dv] = await tx
    .insert(disbursementVouchers)
    .values({
      dvNo,
      dvDate: input.date,
      payee: input.payee.trim(),
      particulars: input.particulars.trim(),
      amount,
      mode: input.mode,
      checkNo: input.checkNo?.trim() || null,
      preparedBy: preparerId,
      createdBy: preparerId,
    })
    .returning();
  if (!dv) throw new Error("DV insert returned no row");
  await tx.insert(dvLines).values(input.lines.map((l, i) => ({ dvId: dv.id, lineNo: i + 1, accountId: l.accountId, memberId: l.memberId, customerId: l.customerId ?? null, amount: l.amount, memo: l.memo, createdBy: preparerId })));
  await audit(tx, { action: "dv.create", entity: "disbursement_voucher", entityId: dv.id, after: { dvNo, payee: dv.payee, amount, mode: dv.mode }, userId: preparerId });
  return dv;
}

async function lockDv(tx: Tx, dvId: string): Promise<DisbursementVoucher> {
  const [dv] = await tx.select().from(disbursementVouchers).where(eq(disbursementVouchers.id, dvId)).for("update");
  if (!dv) throw new CashieringError("Disbursement voucher not found");
  return dv;
}

/** Approves a DV. The approver can't be the preparer. */
export async function approveDv(tx: Tx, dvId: string, approverId: string): Promise<DisbursementVoucher> {
  const dv = await lockDv(tx, dvId);
  if (dv.status !== "DRAFT") throw new CashieringError(`${dv.dvNo} is already ${dv.status}`);
  assertNotSameUser(dv.preparedBy, approverId);
  const [after] = await tx.update(disbursementVouchers).set({ status: "APPROVED", approvedBy: approverId, approvedAt: now() }).where(eq(disbursementVouchers.id, dvId)).returning();
  if (!after) throw new Error("DV update returned no row");
  await audit(tx, { action: "dv.approve", entity: "disbursement_voucher", entityId: dvId, after: { dvNo: dv.dvNo }, userId: approverId });
  return after;
}

/**
 * Releases an approved DV: one CDJ entry (Dr the DV lines / Cr Cash on Hand for cash, Cash in Bank
 * for a check). A cash release comes out of the releasing teller's open session.
 */
export async function releaseDv(tx: Tx, dvId: string, tellerId: string): Promise<DisbursementVoucher> {
  const dv = await lockDv(tx, dvId);
  if (dv.status !== "APPROVED") throw new CashieringError(dv.status === "DRAFT" ? `${dv.dvNo} isn't approved yet` : `${dv.dvNo} is already ${dv.status}`);
  const session = dv.mode === "CASH" ? await requireOpenSession(tx, tellerId) : null;
  if (session) await assertDrawerHas(tx, session.id, dv.amount);
  const lines = await tx.select().from(dvLines).where(eq(dvLines.dvId, dvId)).orderBy(asc(dvLines.lineNo));
  const date = businessToday();
  const credit = await accountIdFor(dv.mode === "CASH" ? "cash_on_hand" : "cash_in_bank", tx);
  const je = await postJournal(
    tx,
    {
      date,
      book: "CDJ",
      particulars: `${dv.dvNo} · ${dv.payee} · ${dv.particulars}`,
      reference: dv.checkNo ?? dv.dvNo,
      source: { module: "cashiering.dv", id: dv.id },
      lines: [...lines.map((l) => ({ accountId: l.accountId, debit: l.amount, memberId: l.memberId, customerId: l.customerId, memo: l.memo })), { accountId: credit, credit: dv.amount }],
    },
    tellerId,
  );
  if (session) await recordCashOut(tx, { sessionId: session.id, type: "DV", refId: dv.id, reference: dv.dvNo, amount: dv.amount, jeId: je.id, date }, tellerId);
  const [after] = await tx
    .update(disbursementVouchers)
    .set({ status: "RELEASED", releasedBy: tellerId, releasedAt: now(), sessionId: session?.id ?? null, jeId: je.id })
    .where(eq(disbursementVouchers.id, dvId))
    .returning();
  if (!after) throw new Error("DV update returned no row");
  await audit(tx, { action: "dv.release", entity: "disbursement_voucher", entityId: dvId, after: { dvNo: dv.dvNo, jeNo: je.jeNo, amount: dv.amount }, userId: tellerId });
  return after;
}

/** Cancels a DV that hasn't been released. Its number stays used. */
export async function cancelDv(tx: Tx, dvId: string, reason: string, actorId: string): Promise<DisbursementVoucher> {
  const dv = await lockDv(tx, dvId);
  if (dv.status === "RELEASED" || dv.status === "CANCELLED") throw new CashieringError(`${dv.dvNo} is ${dv.status} and can't be cancelled`);
  if (!reason.trim()) throw new CashieringError("A reason is required");
  const [after] = await tx.update(disbursementVouchers).set({ status: "CANCELLED", cancelReason: reason.trim() }).where(eq(disbursementVouchers.id, dvId)).returning();
  if (!after) throw new Error("DV update returned no row");
  await audit(tx, { action: "dv.cancel", entity: "disbursement_voucher", entityId: dvId, after: { dvNo: dv.dvNo, reason: reason.trim() }, userId: actorId });
  return after;
}

/** Deposits drawer cash to the bank: Dr Cash in Bank / Cr Cash on Hand, recorded as a cash-out. */
export async function bankDeposit(tx: Tx, input: { amount: Money; bankReference: string }, tellerId: string): Promise<void> {
  if (input.amount <= 0n) throw new CashieringError("The amount must be more than zero");
  if (!input.bankReference.trim()) throw new CashieringError("Enter the deposit slip / bank reference");
  const session = await requireOpenSession(tx, tellerId);
  await assertDrawerHas(tx, session.id, input.amount);
  const date = businessToday();
  const [bank, cash] = await Promise.all([accountIdFor("cash_in_bank", tx), accountIdFor("cash_on_hand", tx)]);
  const je = await postJournal(
    tx,
    {
      date,
      book: "CDJ",
      particulars: `Bank deposit ${input.bankReference.trim()}`,
      reference: input.bankReference.trim(),
      source: { module: "cashiering.deposit", id: session.id },
      lines: [
        { accountId: bank, debit: input.amount },
        { accountId: cash, credit: input.amount },
      ],
    },
    tellerId,
  );
  await recordCashOut(tx, { sessionId: session.id, type: "BANK_DEPOSIT", refId: null, reference: input.bankReference.trim(), amount: input.amount, jeId: je.id, date }, tellerId);
  await audit(tx, { action: "cash.bank_deposit", entity: "teller_session", entityId: session.id, after: { amount: input.amount, reference: input.bankReference.trim(), jeNo: je.jeNo }, userId: tellerId });
}
