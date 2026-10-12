import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { registerDailyJob } from "@/lib/cron";
import { format } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { registerCashOut, registerReceiptItem, type ItemInput, type ReceiptContext } from "@/modules/cashiering/registry";
import { receipts } from "@/modules/cashiering/schema";
import { loans } from "./schema";
import { LoanError } from "./service";
import {
  checkPaymentReversal,
  getLoan,
  loanPaymentLines,
  loansDaily,
  planLoanPayment,
  planRecovery,
  recordLoanPayment,
  recoverable,
  recoveryLines,
  reverseLoanPayment,
  type LoanPaymentPlan,
} from "./servicing";

/**
 * Loans at the teller counter (PHASE-11 T11.8): receipt item LOAN_PAYMENT (dues = what is due now,
 * penalties included; on a written-off loan, a recovery), cash-out LOAN_PROCEEDS, and the daily job.
 */

async function asCashiering<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LoanError) throw new CashieringError(e.message);
    throw e;
  }
}

/** Loans already in this receipt (one payment per loan per receipt). */
const inReceipt = new WeakMap<ReceiptContext, Set<string>>();

async function planFor(tx: Tx, input: ItemInput, ctx: ReceiptContext): Promise<LoanPaymentPlan> {
  if (ctx.payor.type !== "MEMBER" || !ctx.payor.id) throw new CashieringError("Choose the member as the payor");
  if (!input.refId) throw new CashieringError("Choose the loan");
  const [loan] = await tx.select({ id: loans.id, memberId: loans.memberId, status: loans.status, loanNo: loans.loanNo }).from(loans).where(eq(loans.id, input.refId));
  if (!loan) throw new CashieringError("Loan not found");
  if (loan.memberId !== ctx.payor.id) throw new CashieringError(`${loan.loanNo} is another member's loan`);
  return asCashiering(() => (loan.status === "WRITTEN_OFF" ? planRecovery(tx, loan.id, input.amount) : planLoanPayment(tx, loan.id, input.amount)));
}

async function receiptInfo(tx: Tx, receiptId: string) {
  const [r] = await tx.select({ jeId: receipts.jeId, receiptNo: receipts.receiptNo, birReceiptNo: receipts.birReceiptNo, date: receipts.receiptDate }).from(receipts).where(eq(receipts.id, receiptId));
  if (!r) throw new Error("receipt not found");
  return r;
}

type Breakdown = { plan: Omit<LoanPaymentPlan, "amount" | "penalty" | "interest" | "principal"> & { amount: string; penalty: string; interest: string; principal: string } };

registerReceiptItem({
  type: "LOAN_PAYMENT",
  label: "Loan payment",
  permission: "loans.collect",
  dues: async (db, payor) => {
    if (payor.type !== "MEMBER" || !payor.id) return [];
    const rows = await db.select().from(loans).where(and(eq(loans.memberId, payor.id), inArray(loans.status, ["ACTIVE", "PAST_DUE", "WRITTEN_OFF"]))).orderBy(asc(loans.loanNo));
    const out = [];
    for (const l of rows) {
      if (l.status === "WRITTEN_OFF") {
        const left = await recoverable(db, l.id);
        if (left > 0n) out.push({ type: "LOAN_PAYMENT", refId: l.id, description: `Loan ${l.loanNo} · written off (recovery up to ${format(left)})`, amount: left, payable: true });
        continue;
      }
      const loan = await getLoan(l.id, db);
      if (!loan) continue;
      const next = loan.schedule.find((r) => r.status !== "PAID");
      const amount = loan.dueNow > 0n ? loan.dueNow : next ? next.principalDue - next.principalPaid + (next.interestDue - next.interestPaid) : 0n;
      if (amount <= 0n) continue;
      const what = loan.dueNow > 0n ? `due now${loan.daysPastDue > 0 ? `, ${loan.daysPastDue} days past due` : ""}${loan.unpaidPenalty > 0n ? " incl. penalties" : ""}` : `next installment ${next?.dueDate ?? ""}`;
      out.push({ type: "LOAN_PAYMENT", refId: l.id, description: `Loan ${l.loanNo} · ${what}`, amount, payable: true });
    }
    return out;
  },
  validate: async (tx, input, ctx) => {
    const seen = inReceipt.get(ctx) ?? new Set<string>();
    if (input.refId && seen.has(input.refId)) throw new CashieringError("Put one payment per loan on a receipt");
    await planFor(tx, input, ctx);
  },
  apply: async (tx, input, ctx) => {
    const plan = await planFor(tx, input, ctx);
    const seen = inReceipt.get(ctx) ?? new Set<string>();
    seen.add(plan.loanId);
    inReceipt.set(ctx, seen);
    const creditLines = plan.kind === "RECOVERY" ? await recoveryLines(tx, plan) : await loanPaymentLines(tx, plan);
    const [loan] = await tx.select({ loanNo: loans.loanNo }).from(loans).where(eq(loans.id, plan.loanId));
    const parts = plan.kind === "RECOVERY" ? "recovery" : [plan.penalty > 0n ? `penalty ${format(plan.penalty)}` : "", plan.interest > 0n ? `interest ${format(plan.interest)}` : "", plan.principal > 0n ? `principal ${format(plan.principal)}` : ""].filter(Boolean).join(", ");
    const breakdown: Breakdown = { plan: { ...plan, amount: String(plan.amount), penalty: String(plan.penalty), interest: String(plan.interest), principal: String(plan.principal) } };
    return { creditLines, description: `Loan ${loan?.loanNo ?? ""} · ${parts}`, refId: plan.loanId, breakdown };
  },
  recorded: async (tx, item, ctx) => {
    const b = (item.breakdown as Breakdown).plan;
    const plan: LoanPaymentPlan = { ...b, amount: BigInt(b.amount), penalty: BigInt(b.penalty), interest: BigInt(b.interest), principal: BigInt(b.principal) };
    const r = await receiptInfo(tx, ctx.receiptId);
    await recordLoanPayment(tx, plan, { payDate: r.date, jeId: r.jeId, refNo: r.receiptNo, birReceiptNo: r.birReceiptNo, receiptItemId: item.id }, ctx.actorId);
  },
  // A cancelled receipt: the latest payment on the loan comes off its installments (checked before the
  // reversal entry, written after it).
  reverse: async (tx, item) => {
    await asCashiering(() => checkPaymentReversal(tx, item.id));
  },
  reversed: async (tx, item, ctx) => {
    if (!ctx.cancelJeId) throw new Error("receipt cancellation has no reversal entry");
    const jeId = ctx.cancelJeId;
    await asCashiering(() => reverseLoanPayment(tx, item.id, jeId, ctx.actorId));
  },
});

registerCashOut({ type: "LOAN_PROCEEDS", label: "Loan proceeds", permission: "cash.session" });

/** Penalties, statuses and the aging snapshot, once per business date (Phase 07 cron runner). */
registerDailyJob({ name: "loans-daily", run: (tx, date) => loansDaily(tx, date) });
