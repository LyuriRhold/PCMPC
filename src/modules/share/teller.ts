import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { format } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { registerCashOut, registerReceiptItem, type ItemInput, type ReceiptContext } from "@/modules/cashiering/registry";
import { receipts } from "@/modules/cashiering/schema";
import { accountIdFor } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import {
  assertFeePayable,
  assertPaymentReversible,
  membershipFeePaid,
  planPayment,
  paymentLines,
  recordMembershipFee,
  recordPayment,
  shareBalance,
  ShareError,
  type PaymentPlan,
  type PendingPayments,
} from "./service";

/**
 * Share capital at the teller counter (PHASE-08): receipt items MEMBERSHIP_FEE and SHARE_PAYMENT
 * (with dues) and the cash-out SHARE_WITHDRAWAL. All share money goes through the teller.
 */

function memberOf(input: ItemInput, ctx: ReceiptContext): string {
  if (ctx.payor.type !== "MEMBER" || !ctx.payor.id) throw new CashieringError("Choose the member as the payor");
  if (input.refId && input.refId !== ctx.payor.id) throw new CashieringError("Share capital is paid by the member it belongs to");
  return ctx.payor.id;
}

async function receiptInfo(tx: Tx, receiptId: string) {
  const [r] = await tx.select({ jeId: receipts.jeId, receiptNo: receipts.receiptNo, birReceiptNo: receipts.birReceiptNo, date: receipts.receiptDate }).from(receipts).where(eq(receipts.id, receiptId));
  if (!r) throw new Error("receipt not found");
  return r;
}

/** Share payments already planned in this receipt (several items for one member add up). */
const pendingByReceipt = new WeakMap<ReceiptContext, Map<string, PendingPayments>>();

/** Share-module rule errors are shown to the teller like any other receipt error. */
async function asCashiering<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ShareError) throw new CashieringError(e.message);
    throw e;
  }
}

async function plan(tx: Tx, input: ItemInput, ctx: ReceiptContext): Promise<PaymentPlan> {
  const memberId = memberOf(input, ctx);
  const pending = pendingByReceipt.get(ctx)?.get(memberId);
  return asCashiering(() => planPayment(tx, memberId, input.amount, pending));
}

type PaymentBreakdown = { memberId: string; amount: string; autoSubscribe: { shares: number; amount: string } | null };

function paymentBreakdown(value: unknown): PaymentBreakdown {
  const b = value as Partial<PaymentBreakdown> | null;
  if (!b || typeof b.memberId !== "string" || typeof b.amount !== "string") throw new Error("share payment item has no breakdown");
  return { memberId: b.memberId, amount: b.amount, autoSubscribe: b.autoSubscribe ?? null };
}

registerReceiptItem({
  type: "SHARE_PAYMENT",
  label: "Share capital payment",
  permission: "share.post",
  dues: async (db, payor) => {
    if (payor.type !== "MEMBER" || !payor.id) return [];
    const { unpaid } = await shareBalance(payor.id, db);
    if (unpaid <= 0n) return [];
    return [{ type: "SHARE_PAYMENT", refId: payor.id, description: `Share capital · unpaid subscription (${format(unpaid)})`, amount: unpaid, payable: true }];
  },
  validate: async (tx, input, ctx) => {
    await plan(tx, input, ctx);
  },
  apply: async (tx, input, ctx) => {
    const p = await plan(tx, input, ctx);
    const pending = pendingByReceipt.get(ctx) ?? new Map<string, PendingPayments>();
    const before = pending.get(p.memberId) ?? { paid: 0n, subscribed: 0n };
    pending.set(p.memberId, { paid: before.paid + p.amount, subscribed: before.subscribed + (p.autoSubscribe?.amount ?? 0n) });
    pendingByReceipt.set(ctx, pending);
    const sub = p.autoSubscribe ? ` (subscribes ${p.autoSubscribe.shares} more shares)` : "";
    return {
      creditLines: await paymentLines(tx, p),
      description: `Share capital payment${sub}`,
      refId: p.memberId,
      breakdown: { memberId: p.memberId, amount: String(p.amount), autoSubscribe: p.autoSubscribe ? { shares: p.autoSubscribe.shares, amount: String(p.autoSubscribe.amount) } : null },
    };
  },
  recorded: async (tx, item, ctx) => {
    const b = paymentBreakdown(item.breakdown);
    const r = await receiptInfo(tx, ctx.receiptId);
    const p: PaymentPlan = { memberId: b.memberId, amount: BigInt(b.amount), autoSubscribe: b.autoSubscribe ? { shares: b.autoSubscribe.shares, amount: BigInt(b.autoSubscribe.amount) } : null };
    await recordPayment(tx, p, { receiptItemId: item.id, jeId: r.jeId, date: r.date, receiptNo: r.receiptNo, birReceiptNo: r.birReceiptNo }, ctx.actorId);
  },
  // The receipt's share rows stop counting once it's CANCELLED; but money already transferred or
  // withdrawn can't be taken back.
  reverse: async (tx, item) => {
    const b = paymentBreakdown(item.breakdown);
    await asCashiering(() => assertPaymentReversible(tx, b.memberId, item.id, item.amount));
  },
});

registerReceiptItem({
  type: "MEMBERSHIP_FEE",
  label: "Membership fee",
  permission: "share.post",
  dues: async (db, payor) => {
    if (payor.type !== "MEMBER" || !payor.id) return [];
    if (await membershipFeePaid(payor.id, db)) return [];
    const fee = BigInt(await getSetting("member.fee", db));
    return [{ type: "MEMBERSHIP_FEE", refId: payor.id, description: "Membership fee", amount: fee, payable: true }];
  },
  validate: async (tx, input, ctx) => {
    const memberId = memberOf(input, ctx);
    const fee = BigInt(await getSetting("member.fee", tx));
    if (input.amount !== fee) throw new CashieringError(`The membership fee is ${format(fee)}`);
    await asCashiering(() => assertFeePayable(tx, memberId));
  },
  apply: async (tx, input, ctx) => {
    const memberId = memberOf(input, ctx);
    return { creditLines: [{ accountId: await accountIdFor("membership_fee_income", tx), credit: input.amount }], description: "Membership fee", refId: memberId, breakdown: { memberId } };
  },
  recorded: async (tx, item, ctx) => {
    const r = await receiptInfo(tx, ctx.receiptId);
    await recordMembershipFee(tx, { memberId: (item.breakdown as { memberId: string }).memberId, amount: item.amount, receiptItemId: item.id, jeId: r.jeId, date: r.date }, ctx.actorId);
  },
  reverse: async () => {},
});

registerCashOut({ type: "SHARE_WITHDRAWAL", label: "Share capital withdrawal", permission: "cash.session" });
