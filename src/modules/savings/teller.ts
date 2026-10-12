import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { registerDailyJob } from "@/lib/cron";
import { CashieringError } from "@/modules/cashiering/builtins";
import { registerCashOut, registerReceiptItem, type ItemInput, type ReceiptContext } from "@/modules/cashiering/registry";
import { receipts } from "@/modules/cashiering/schema";
import { checkDeposit, depositableAccounts, markDormant, recordDeposit, reverseDeposit, SavingsError } from "./service";

/**
 * Savings at the teller counter (PHASE-09 T9.5): receipt item SAVINGS_DEPOSIT (the member's
 * savings accounts appear as open-amount dues), cash-out SAVINGS_WITHDRAWAL, and the daily
 * dormancy job.
 */

/** Savings rule errors are shown to the teller like any other receipt error. */
async function asCashiering<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SavingsError) throw new CashieringError(e.message);
    throw e;
  }
}

function payorMember(ctx: ReceiptContext): string {
  if (ctx.payor.type !== "MEMBER" || !ctx.payor.id) throw new CashieringError("Choose the member as the payor");
  return ctx.payor.id;
}

function accountOf(input: Pick<ItemInput, "refId">): string {
  if (!input.refId) throw new CashieringError("Choose the savings account");
  return input.refId;
}

async function receiptInfo(tx: Tx, receiptId: string) {
  const [r] = await tx.select({ jeId: receipts.jeId, receiptNo: receipts.receiptNo, birReceiptNo: receipts.birReceiptNo, date: receipts.receiptDate }).from(receipts).where(eq(receipts.id, receiptId));
  if (!r) throw new Error("receipt not found");
  return r;
}

registerReceiptItem({
  type: "SAVINGS_DEPOSIT",
  label: "Savings deposit",
  permission: "savings.post",
  dues: async (db, payor) => {
    if (payor.type !== "MEMBER" || !payor.id) return [];
    const accounts = await depositableAccounts(payor.id, db);
    return accounts.map((a) => ({
      type: "SAVINGS_DEPOSIT",
      refId: a.id,
      description: `Savings deposit · ${a.accountNo}${a.status === "DORMANT" ? " (dormant; a deposit reactivates it)" : ""}`,
      amount: 0n,
      payable: true,
      openAmount: true,
    }));
  },
  validate: async (tx, input, ctx) => {
    await asCashiering(() => checkDeposit(tx, { accountId: accountOf(input), payorMemberId: payorMember(ctx), amount: input.amount }));
  },
  apply: async (tx, input, ctx) => {
    const r = await asCashiering(() => checkDeposit(tx, { accountId: accountOf(input), payorMemberId: payorMember(ctx), amount: input.amount }));
    return { creditLines: r.creditLines, description: `Savings deposit · ${r.account.accountNo}`, refId: r.account.id, breakdown: { accountId: r.account.id } };
  },
  recorded: async (tx, item, ctx) => {
    const r = await receiptInfo(tx, ctx.receiptId);
    await recordDeposit(tx, { accountId: accountOf(item), amount: item.amount, receiptItemId: item.id, jeId: r.jeId, date: r.date, receiptNo: r.receiptNo, birReceiptNo: r.birReceiptNo }, ctx.actorId);
  },
  // A cancelled deposit comes back out of the passbook (an ADJUSTMENT on the cancellation entry),
  // unless it was already withdrawn.
  reverse: async (tx, item, ctx) => {
    if (!ctx.cancelJeId) throw new Error("receipt cancellation has no reversal entry");
    const jeId = ctx.cancelJeId;
    await asCashiering(() => reverseDeposit(tx, { accountId: accountOf(item), amount: item.amount, receiptNo: ctx.receiptNo, date: ctx.date, jeId }, ctx.actorId));
  },
});

registerCashOut({ type: "SAVINGS_WITHDRAWAL", label: "Savings withdrawal", permission: "cash.session" });

registerDailyJob({ name: "savings-dormancy", run: (tx, date) => markDormant(tx, date) });
