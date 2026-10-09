import Decimal from "decimal.js";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { businessToday, monthEnd, type BusinessDate } from "@/lib/dates";
import { divide, format, type Money } from "@/lib/money";
import { receiptItems, receipts } from "@/modules/cashiering/schema";
import { payOut } from "@/modules/cashiering/service";
import { journalEntries } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { registerTerminationRule } from "@/modules/members/termination";
import { getSetting } from "@/modules/settings/service";
import { memberFees, memberShareBalance, shareSubscriptions, shareTransactions, type ShareTxnType } from "./schema";

/**
 * Share capital (PHASE-08 T8.2/T8.3). Every money movement posts its journal entry in the same
 * transaction as its share-ledger rows. Paid-up = Subscribed Share Capital − Subscription
 * Receivable for the member (DOMAIN §6).
 */

/** A share-capital rule was broken; the message is safe to show. */
export class ShareError extends Error {
  override name = "ShareError";
}

const KEYS = { receivable: "subscription_receivable_common", capital: "subscribed_share_capital_common", fee: "membership_fee_income" } as const;

/** What each ledger row type does to subscribed and paid-up. */
export const EFFECT: Record<ShareTxnType, { subscribed: -1 | 0 | 1; paidUp: -1 | 0 | 1 }> = {
  SUBSCRIBE: { subscribed: 1, paidUp: 0 },
  PAYMENT: { subscribed: 0, paidUp: 1 },
  CBU_RETENTION: { subscribed: 0, paidUp: 1 },
  ISC_CAPITALIZED: { subscribed: 0, paidUp: 1 },
  PR_CAPITALIZED: { subscribed: 0, paidUp: 1 },
  TRANSFER_IN: { subscribed: 1, paidUp: 1 },
  TRANSFER_OUT: { subscribed: -1, paidUp: -1 },
  WITHDRAWAL: { subscribed: -1, paidUp: -1 },
  ADJUSTMENT: { subscribed: -1, paidUp: 0 },
};

export type ShareBalance = { subscribed: Money; paidUp: Money; unpaid: Money };

export async function shareBalance(memberId: string, db: Db | Tx = getDb()): Promise<ShareBalance> {
  const [r] = await db.select().from(memberShareBalance).where(eq(memberShareBalance.memberId, memberId));
  return r ? { subscribed: BigInt(r.subscribed), paidUp: BigInt(r.paidUp), unpaid: BigInt(r.unpaid) } : { subscribed: 0n, paidUp: 0n, unpaid: 0n };
}

/** The cooperative's total paid-up share capital. */
export async function totalPaidUp(db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await db.select({ total: sql<string>`COALESCE(SUM(${memberShareBalance.paidUp}), 0)` }).from(memberShareBalance);
  return BigInt(r?.total ?? "0");
}

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;

async function lockMember(tx: Tx, memberId: string): Promise<MemberRow> {
  const [m] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (!m) throw new ShareError("Member not found");
  return m;
}

function assertMember(m: MemberRow, what: string): void {
  if (!m.memberNo || (m.status !== "ACTIVE" && m.status !== "INACTIVE")) throw new ShareError(`${nameOf(m)} is ${m.status}; only approved members can ${what}`);
}

async function txn(tx: Tx, row: { memberId: string; type: ShareTxnType; amount: Money; jeId: string; date: BusinessDate; refNo?: string | null; birReceiptNo?: string | null; subscriptionId?: string | null; receiptItemId?: string | null; remarks?: string | null }, actorId: string | null) {
  await tx.insert(shareTransactions).values({
    memberId: row.memberId,
    txnDate: row.date,
    type: row.type,
    amount: row.amount,
    refNo: row.refNo ?? null,
    birReceiptNo: row.birReceiptNo ?? null,
    subscriptionId: row.subscriptionId ?? null,
    receiptItemId: row.receiptItemId ?? null,
    jeId: row.jeId,
    remarks: row.remarks ?? null,
    createdBy: actorId,
  });
}

// ── Subscriptions ──

/**
 * Subscribes `shares` at the current par value: Dr Subscription Receivable / Cr Subscribed Share
 * Capital (member-tagged). The member's total subscription must reach share.min_subscription_shares.
 */
export async function subscribe(tx: Tx, input: { memberId: string; shares: number }, actorId: string) {
  const m = await lockMember(tx, input.memberId);
  assertMember(m, "subscribe to shares");
  if (!Number.isInteger(input.shares) || input.shares <= 0) throw new ShareError("Enter the number of shares (a whole number)");
  const [par, minShares] = await Promise.all([getSetting("share.par_value", tx).then(BigInt), getSetting("share.min_subscription_shares", tx)]);
  const amount = par * BigInt(input.shares);
  const balance = await shareBalance(m.id, tx);
  if (balance.subscribed + amount < par * BigInt(minShares)) {
    throw new ShareError(`The subscription must total at least ${minShares} shares (${format(par * BigInt(minShares))})`);
  }
  const date = businessToday();
  const je = await postJournal(
    tx,
    {
      date,
      book: "GJ",
      particulars: `Share subscription · ${m.memberNo} ${nameOf(m)} · ${input.shares} shares × ${format(par)}`,
      reference: m.memberNo,
      source: { module: "share", id: m.id },
      lines: [
        { accountId: await accountIdFor(KEYS.receivable, tx), debit: amount, memberId: m.id },
        { accountId: await accountIdFor(KEYS.capital, tx), credit: amount, memberId: m.id },
      ],
    },
    actorId,
  );
  const [sub] = await tx.insert(shareSubscriptions).values({ memberId: m.id, subDate: date, shares: input.shares, parValue: par, amount, jeId: je.id, createdBy: actorId }).returning();
  if (!sub) throw new Error("subscription insert returned no row");
  await txn(tx, { memberId: m.id, type: "SUBSCRIBE", amount, jeId: je.id, date, subscriptionId: sub.id, remarks: `${input.shares} shares × ${format(par)}` }, actorId);
  await audit(tx, { action: "share.subscribe", entity: "member", entityId: m.id, after: { shares: input.shares, amount: format(amount), jeNo: je.jeNo }, userId: actorId });
  return { id: sub.id, jeId: je.id, amount };
}

// ── Payments (teller) ──

/**
 * The holding cap (RA 9520): after the payment the member's paid-up ÷ the coop's total paid-up
 * must be ≤ share.max_holding_pct. A member can always reach share.min_paid_up_regular (CONFIRM
 * Q-08.1): otherwise no early member could ever pay the minimum.
 */
async function assertHoldingCap(tx: Tx, m: MemberRow, currentPaidUp: Money, increase: Money): Promise<void> {
  const [cap, minPaidUp] = await Promise.all([getSetting("share.max_holding_pct", tx), getSetting("share.min_paid_up_regular", tx).then(BigInt)]);
  const after = currentPaidUp + increase;
  if (after <= minPaidUp) return;
  const total = (await totalPaidUp(tx)) + increase;
  if (new Decimal(after.toString()).div(total.toString()).lte(cap)) return;
  const pct = new Decimal(after.toString()).mul(100).div(total.toString()).toFixed(2, Decimal.ROUND_HALF_UP);
  const limit = new Decimal(cap).mul(100).toString();
  throw new ShareError(`Payment would raise ${nameOf(m)}'s paid-up capital to ${pct}% of the coop's total (${format(after)} of ${format(total)}); the limit is ${limit}%`);
}

export type PaymentPlan = { memberId: string; amount: Money; autoSubscribe: { shares: number; amount: Money } | null };

/**
 * Checks a share payment and returns its plan: it can't exceed the unpaid subscription, unless
 * share.auto_subscribe_excess, in which case enough whole shares are subscribed for the excess.
 * `pending` = amounts already planned in the same receipt.
 */
export async function planPayment(tx: Tx, memberId: string, amount: Money, pending: Money = 0n): Promise<PaymentPlan> {
  const m = await lockMember(tx, memberId);
  assertMember(m, "pay for shares");
  if (amount <= 0n) throw new ShareError("The amount must be more than zero");
  const balance = await shareBalance(m.id, tx);
  const unpaid = balance.unpaid - pending;
  let autoSubscribe: PaymentPlan["autoSubscribe"] = null;
  if (amount > unpaid) {
    if (!(await getSetting("share.auto_subscribe_excess", tx))) throw new ShareError(`Payment exceeds unpaid subscription (${format(unpaid < 0n ? 0n : unpaid)})`);
    const par = BigInt(await getSetting("share.par_value", tx));
    const shares = Number((amount - unpaid + par - 1n) / par);
    autoSubscribe = { shares, amount: par * BigInt(shares) };
  }
  await assertHoldingCap(tx, m, balance.paidUp + pending, amount);
  return { memberId: m.id, amount, autoSubscribe };
}

/** Credit lines of a share payment for the receipt's entry (plus the auto-subscription, if any). */
export async function paymentLines(tx: Tx, plan: PaymentPlan): Promise<LineInput[]> {
  const [rec, cap] = await Promise.all([accountIdFor(KEYS.receivable, tx), accountIdFor(KEYS.capital, tx)]);
  const lines: LineInput[] = [];
  if (plan.autoSubscribe) {
    lines.push({ accountId: rec, debit: plan.autoSubscribe.amount, memberId: plan.memberId, memo: "Auto-subscription" });
    lines.push({ accountId: cap, credit: plan.autoSubscribe.amount, memberId: plan.memberId, memo: "Auto-subscription" });
  }
  lines.push({ accountId: rec, credit: plan.amount, memberId: plan.memberId });
  return lines;
}

/** Writes the share-ledger rows of a recorded teller payment. */
export async function recordPayment(tx: Tx, plan: PaymentPlan, ctx: { receiptItemId: string; jeId: string; date: BusinessDate; receiptNo: string; birReceiptNo: string | null }, actorId: string): Promise<void> {
  if (plan.autoSubscribe) {
    const par = plan.autoSubscribe.amount / BigInt(plan.autoSubscribe.shares);
    const [sub] = await tx
      .insert(shareSubscriptions)
      .values({ memberId: plan.memberId, subDate: ctx.date, shares: plan.autoSubscribe.shares, parValue: par, amount: plan.autoSubscribe.amount, jeId: ctx.jeId, createdBy: actorId })
      .returning();
    await txn(tx, { memberId: plan.memberId, type: "SUBSCRIBE", amount: plan.autoSubscribe.amount, jeId: ctx.jeId, date: ctx.date, subscriptionId: sub?.id ?? null, receiptItemId: ctx.receiptItemId, refNo: ctx.receiptNo, remarks: "Subscribed with a payment above the unpaid subscription" }, actorId);
  }
  await txn(tx, { memberId: plan.memberId, type: "PAYMENT", amount: plan.amount, jeId: ctx.jeId, date: ctx.date, receiptItemId: ctx.receiptItemId, refNo: ctx.receiptNo, birReceiptNo: ctx.birReceiptNo }, actorId);
}

// ── Membership fee ──

/** Whether the member's membership fee is paid (on a VALID receipt). */
export async function membershipFeePaid(memberId: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [r] = await db
    .select({ id: memberFees.id })
    .from(memberFees)
    .innerJoin(receiptItems, eq(receiptItems.id, memberFees.receiptItemId))
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(memberFees.memberId, memberId), eq(memberFees.feeType, "MEMBERSHIP"), eq(receipts.status, "VALID")))
    .limit(1);
  return !!r;
}

export async function recordMembershipFee(tx: Tx, input: { memberId: string; amount: Money; receiptItemId: string; jeId: string; date: BusinessDate }, actorId: string): Promise<void> {
  await tx.insert(memberFees).values({ memberId: input.memberId, feeType: "MEMBERSHIP", amount: input.amount, paidAt: input.date, receiptItemId: input.receiptItemId, jeId: input.jeId, createdBy: actorId });
}

/** Good standing (for loans, Phase 10): paid-up ≥ share.min_paid_up_regular and the membership fee is paid. */
export async function isGoodStanding(memberId: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [balance, minPaidUp, fee] = await Promise.all([shareBalance(memberId, db), getSetting("share.min_paid_up_regular", db).then(BigInt), membershipFeePaid(memberId, db)]);
  return balance.paidUp >= minPaidUp && fee;
}

// ── Transfers ──

/**
 * Transfers paid-up capital between two ACTIVE members on a Board resolution: Dr Subscribed Share
 * Capital (from) / Cr Subscribed Share Capital (to). The GL control total doesn't change.
 */
export async function transfer(tx: Tx, input: { fromMemberId: string; toMemberId: string; amount: Money; bodRef: string }, actorId: string) {
  if (input.fromMemberId === input.toMemberId) throw new ShareError("Choose two different members");
  if (!input.bodRef.trim()) throw new ShareError("Enter the Board resolution that approved the transfer");
  if (input.amount <= 0n) throw new ShareError("The amount must be more than zero");
  // Lock both members in a fixed order so two opposite transfers can't deadlock.
  const [first, second] = [input.fromMemberId, input.toMemberId].sort();
  const a = await lockMember(tx, first!);
  const b = await lockMember(tx, second!);
  const from = a.id === input.fromMemberId ? a : b;
  const to = a.id === input.toMemberId ? a : b;
  for (const m of [from, to]) if (m.status !== "ACTIVE" || !m.memberNo) throw new ShareError(`${nameOf(m)} is ${m.status}; transfers are between ACTIVE members only`);
  const balance = await shareBalance(from.id, tx);
  if (input.amount > balance.paidUp) throw new ShareError(`${nameOf(from)} has only ${format(balance.paidUp)} paid-up`);
  const date = businessToday();
  const cap = await accountIdFor(KEYS.capital, tx);
  const bodRef = input.bodRef.trim();
  const je = await postJournal(
    tx,
    {
      date,
      book: "GJ",
      particulars: `Share transfer ${from.memberNo} → ${to.memberNo} (${bodRef})`,
      reference: bodRef,
      source: { module: "share", id: from.id },
      lines: [
        { accountId: cap, debit: input.amount, memberId: from.id, memo: `Transfer to ${to.memberNo}` },
        { accountId: cap, credit: input.amount, memberId: to.id, memo: `Transfer from ${from.memberNo}` },
      ],
    },
    actorId,
  );
  await txn(tx, { memberId: from.id, type: "TRANSFER_OUT", amount: input.amount, jeId: je.id, date, refNo: bodRef, remarks: `To ${to.memberNo} ${nameOf(to)}` }, actorId);
  await txn(tx, { memberId: to.id, type: "TRANSFER_IN", amount: input.amount, jeId: je.id, date, refNo: bodRef, remarks: `From ${from.memberNo} ${nameOf(from)}` }, actorId);
  await audit(tx, { action: "share.transfer", entity: "member", entityId: from.id, after: { to: to.memberNo, amount: format(input.amount), bodRef, jeNo: je.jeNo }, userId: actorId });
  return { jeId: je.id };
}

// ── Withdrawal (termination) ──

export type ShareOffset = {
  name: string;
  /** Credit lines settling what the member owes (e.g. an unpaid loan, Phase 11), up to `available`. */
  lines: (tx: Tx, memberId: string, available: Money) => Promise<{ amount: Money; lines: LineInput[]; description: string }>;
};
const offsets: ShareOffset[] = [];

/** Phase 11 registers the loan offset here: obligations are deducted before the payout. */
export function registerShareOffset(offset: ShareOffset): void {
  const i = offsets.findIndex((o) => o.name === offset.name);
  if (i >= 0) offsets[i] = offset;
  else offsets.push(offset);
}

/**
 * Settles a member's share capital before termination: the unpaid subscription is cancelled
 * (Dr Subscribed Share Capital / Cr Subscription Receivable), obligations are offset, and the rest
 * of the paid-up is paid out in cash by the teller (cash-out SHARE_WITHDRAWAL).
 */
export async function withdraw(tx: Tx, input: { memberId: string; reason: string }, tellerId: string) {
  const m = await lockMember(tx, input.memberId);
  assertMember(m, "withdraw share capital");
  if (!input.reason.trim()) throw new ShareError("Enter the reason (the member's termination)");
  const balance = await shareBalance(m.id, tx);
  if (balance.subscribed <= 0n) throw new ShareError(`${nameOf(m)} has no share capital to withdraw`);
  const [rec, cap] = await Promise.all([accountIdFor(KEYS.receivable, tx), accountIdFor(KEYS.capital, tx)]);

  const offsetLines: LineInput[] = [];
  let available = balance.paidUp;
  const notes: string[] = [];
  for (const o of offsets) {
    const r = await o.lines(tx, m.id, available);
    if (r.amount > 0n) {
      offsetLines.push(...r.lines);
      available -= r.amount;
      notes.push(`${r.description} ${format(r.amount)}`);
    }
  }
  const cash = available;
  const debitLines: LineInput[] = [{ accountId: cap, debit: balance.subscribed, memberId: m.id }];
  const otherCredits: LineInput[] = [...(balance.unpaid > 0n ? [{ accountId: rec, credit: balance.unpaid, memberId: m.id, memo: "Unpaid subscription cancelled" }] : []), ...offsetLines];
  const particulars = `Share capital withdrawal · ${m.memberNo} ${nameOf(m)} · ${input.reason.trim()}`;
  const date = businessToday();
  let jeId: string;
  if (cash > 0n) {
    ({ jeId } = await payOut(tx, { type: "SHARE_WITHDRAWAL", refId: m.id, reference: m.memberNo ?? "", particulars, amount: cash, debitLines, otherCredits, source: { module: "share", id: m.id } }, tellerId));
  } else {
    const je = await postJournal(tx, { date, book: "GJ", particulars, reference: m.memberNo, source: { module: "share", id: m.id }, lines: [...debitLines, ...otherCredits] }, tellerId);
    jeId = je.id;
  }
  if (balance.unpaid > 0n) await txn(tx, { memberId: m.id, type: "ADJUSTMENT", amount: balance.unpaid, jeId, date, remarks: "Unpaid subscription cancelled on withdrawal" }, tellerId);
  if (balance.paidUp > 0n) await txn(tx, { memberId: m.id, type: "WITHDRAWAL", amount: balance.paidUp, jeId, date, remarks: [input.reason.trim(), ...notes].join("; ") }, tellerId);
  await audit(tx, { action: "share.withdraw", entity: "member", entityId: m.id, after: { paidUp: format(balance.paidUp), cash: format(cash), offsets: notes, reason: input.reason.trim() }, userId: tellerId });
  return { jeId, cash, paidUp: balance.paidUp };
}

registerTerminationRule({
  name: "share-capital",
  check: async (memberId, db) => {
    const b = await shareBalance(memberId, db);
    if (b.subscribed === 0n && b.paidUp === 0n) return null;
    return `share capital must be fully withdrawn/settled first (paid-up ${format(b.paidUp)}, unpaid subscription ${format(b.unpaid)})`;
  },
});

// ── CBU retention (Phase 11 loan release) ──

/**
 * CBU retention on a loan release: the credit line(s) for the release entry. If the unpaid
 * subscription is smaller than the retention, enough whole shares are subscribed first (CONFIRM Q-08.2).
 */
export async function cbuLines(tx: Tx, memberId: string, amount: Money): Promise<LineInput[]> {
  const m = await lockMember(tx, memberId);
  assertMember(m, "have CBU retained");
  if (amount <= 0n) throw new ShareError("The CBU amount must be more than zero");
  const { unpaid } = await shareBalance(m.id, tx);
  const par = BigInt(await getSetting("share.par_value", tx));
  const plan: PaymentPlan = { memberId: m.id, amount, autoSubscribe: null };
  if (amount > unpaid) {
    const shares = Number((amount - unpaid + par - 1n) / par);
    plan.autoSubscribe = { shares, amount: par * BigInt(shares) };
  }
  return paymentLines(tx, plan);
}

/** Records the CBU retained by an entry the caller posted with `cbuLines` (credits paid-up). */
export async function retainCbu(tx: Tx, memberId: string, amount: Money, source: { jeId: string; ref: string }, actorId: string | null): Promise<void> {
  const { unpaid } = await shareBalance(memberId, tx);
  const date = businessToday();
  if (amount > unpaid) {
    const par = BigInt(await getSetting("share.par_value", tx));
    const shares = Number((amount - unpaid + par - 1n) / par);
    const [sub] = await tx.insert(shareSubscriptions).values({ memberId, subDate: date, shares, parValue: par, amount: par * BigInt(shares), jeId: source.jeId, createdBy: actorId }).returning();
    await txn(tx, { memberId, type: "SUBSCRIBE", amount: par * BigInt(shares), jeId: source.jeId, date, subscriptionId: sub?.id ?? null, refNo: source.ref, remarks: "Subscribed for CBU retention" }, actorId);
  }
  await txn(tx, { memberId, type: "CBU_RETENTION", amount, jeId: source.jeId, date, refNo: source.ref }, actorId);
}

// ── Ledger and ASM ──

/** Share-ledger rows that count (teller rows only while their receipt is VALID), oldest first. */
async function countedRows(db: Db | Tx, memberId: string, to?: BusinessDate) {
  return db
    .select({ t: shareTransactions, jeNo: journalEntries.jeNo })
    .from(shareTransactions)
    .innerJoin(journalEntries, eq(journalEntries.id, shareTransactions.jeId))
    .leftJoin(receiptItems, eq(receiptItems.id, shareTransactions.receiptItemId))
    .leftJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(shareTransactions.memberId, memberId), or(sql`${shareTransactions.receiptItemId} IS NULL`, eq(receipts.status, "VALID")), to ? lte(shareTransactions.txnDate, to) : undefined))
    .orderBy(asc(shareTransactions.txnDate), asc(shareTransactions.seq));
}

export type LedgerRow = {
  id: string;
  date: BusinessDate;
  type: ShareTxnType;
  refNo: string | null;
  jeId: string;
  jeNo: string | null;
  remarks: string | null;
  subscribed: Money;
  paidUp: Money;
  subscribedBalance: Money;
  paidUpBalance: Money;
};

/** The member share ledger with running subscribed and paid-up balances (optionally a date range). */
export async function memberShareLedger(memberId: string, range: { from?: BusinessDate; to?: BusinessDate } = {}, db: Db | Tx = getDb()) {
  const rows = await countedRows(db, memberId, range.to);
  let subscribed = 0n;
  let paidUp = 0n;
  let opening = { subscribed: 0n, paidUp: 0n };
  const out: LedgerRow[] = [];
  for (const { t, jeNo } of rows) {
    const e = EFFECT[t.type];
    subscribed += BigInt(e.subscribed) * t.amount;
    paidUp += BigInt(e.paidUp) * t.amount;
    if (range.from && t.txnDate < range.from) {
      opening = { subscribed, paidUp };
      continue;
    }
    out.push({
      id: t.id,
      date: t.txnDate,
      type: t.type,
      refNo: t.refNo,
      jeId: t.jeId,
      jeNo,
      remarks: t.remarks,
      subscribed: BigInt(e.subscribed) * t.amount,
      paidUp: BigInt(e.paidUp) * t.amount,
      subscribedBalance: subscribed,
      paidUpBalance: paidUp,
    });
  }
  return { opening, rows: out, closing: { subscribed, paidUp } };
}

/**
 * Average Share Month (DOMAIN share.asm_basis = month-end balance): Σ of the 12 month-end
 * paid-up balances of the year ÷ 12, rounded HALF-UP to the centavo.
 */
export async function averageShareMonth(memberId: string, year: number, db: Db | Tx = getDb()): Promise<Money> {
  const rows = await countedRows(db, memberId, `${year}-12-31`);
  let total = 0n;
  for (let month = 1; month <= 12; month++) {
    const end = monthEnd(`${year}-${String(month).padStart(2, "0")}-01`);
    total += rows.filter((r) => r.t.txnDate <= end).reduce((s, r) => s + BigInt(EFFECT[r.t.type].paidUp) * r.t.amount, 0n);
  }
  return divide(total, 12n);
}

/** Subscriptions of a member, newest first. */
export async function memberSubscriptions(memberId: string, db: Db | Tx = getDb()) {
  return db.select().from(shareSubscriptions).where(eq(shareSubscriptions.memberId, memberId)).orderBy(asc(shareSubscriptions.subDate));
}

/** Several members' balances at once (for lists). */
export async function shareBalances(memberIds: string[], db: Db | Tx = getDb()) {
  if (memberIds.length === 0) return new Map<string, ShareBalance>();
  const rows = await db.select().from(memberShareBalance).where(inArray(memberShareBalance.memberId, memberIds));
  return new Map(rows.map((r) => [r.memberId, { subscribed: BigInt(r.subscribed), paidUp: BigInt(r.paidUp), unpaid: BigInt(r.unpaid) }]));
}
