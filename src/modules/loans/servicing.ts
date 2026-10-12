import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addMonths, businessToday, daysBetween, formatDate, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { payOut } from "@/modules/cashiering/service";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { registerTerminationRule } from "@/modules/members/termination";
import { checkTransferIn, checkTransferOut, recordTransfer, savingsGlAccountId } from "@/modules/savings/service";
import { getSetting } from "@/modules/settings/service";
import { cbuLines, registerShareOffset, retainCbu } from "@/modules/share/service";
import { bucketFor, daysPastDue, penaltyToDate } from "./aging";
import { schedule } from "./amortization";
import { registerPastDueHook } from "./eligibility";
import {
  loanAgingSnapshots,
  loanApplicationComakers,
  loanApplications,
  loanApprovals,
  loanPayments,
  loanPenaltyAccruals,
  loans,
  loanSchedule,
  type Disbursement,
  type Loan,
  type LoanScheduleRow,
  type LoanStatus,
  type PaymentAllocation,
  type PaymentKind,
} from "./schema";
import { LoanError } from "./service";

/**
 * Loan servicing (PHASE-11): release, payments, penalties, aging, write-off, restructure and
 * offsets. Every money movement posts its entry in the same transaction as the loan records;
 * cash goes through the teller (receipt item LOAN_PAYMENT, cash-out LOAN_PROCEEDS). Interest is
 * income when collected (loan.interest_recognition): the receivable carries principal only.
 */

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;
const OPEN: LoanStatus[] = ["ACTIVE", "PAST_DUE"];

// ── Reading a loan ──

const unpaidOf = (r: LoanScheduleRow) => ({ penalty: r.penaltyAccrued - r.penaltyPaid, interest: r.interestDue - r.interestPaid, principal: r.principalDue - r.principalPaid });
const sumOf = (rows: LoanScheduleRow[], k: "penalty" | "interest" | "principal") => rows.reduce((s, r) => s + unpaidOf(r)[k], 0n);

/** The oldest installment that isn't fully paid (null when all are paid). */
function oldestUnpaid(rows: LoanScheduleRow[]): LoanScheduleRow | null {
  return rows.filter((r) => r.status !== "PAID").sort((a, b) => a.no - b.no)[0] ?? null;
}

async function scheduleOf(db: Db | Tx, loanId: string): Promise<LoanScheduleRow[]> {
  return db.select().from(loanSchedule).where(eq(loanSchedule.loanId, loanId)).orderBy(asc(loanSchedule.no));
}

async function lockLoan(tx: Tx, loanId: string): Promise<Loan> {
  const [l] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
  if (!l) throw new LoanError("Loan not found");
  return l;
}

/** A loan with its member, schedule, payments and balances (the loan ledger card). */
export async function getLoan(loanId: string, db: Db | Tx = getDb()) {
  const [row] = await db.select({ loan: loans, member: members }).from(loans).innerJoin(members, eq(members.id, loans.memberId)).where(eq(loans.id, loanId));
  if (!row) return null;
  const rows = await scheduleOf(db, loanId);
  const payments = await db.select().from(loanPayments).where(eq(loanPayments.loanId, loanId)).orderBy(asc(loanPayments.seq));
  const today = businessToday();
  const oldest = oldestUnpaid(rows);
  const [restructuredInto] = await db.select({ id: loans.id, loanNo: loans.loanNo }).from(loans).where(eq(loans.restructuredFromId, loanId));
  return {
    ...row,
    schedule: rows,
    payments,
    outstandingPrincipal: sumOf(rows, "principal"),
    unpaidInterest: sumOf(rows, "interest"),
    unpaidPenalty: sumOf(rows, "penalty"),
    /** Everything due up to today (penalties, interest and principal of installments due). */
    dueNow: rows.filter((r) => r.dueDate <= today).reduce((s, r) => s + unpaidOf(r).penalty + unpaidOf(r).interest + unpaidOf(r).principal, 0n),
    daysPastDue: OPEN.includes(row.loan.status) ? daysPastDue(oldest?.dueDate ?? null, today) : 0,
    restructuredInto: restructuredInto ?? null,
  };
}

/** A member's loans, newest first, with outstanding principal (Loans tab). */
export async function memberLoans(memberId: string, db: Db | Tx = getDb()) {
  const rows = await db.select().from(loans).where(eq(loans.memberId, memberId)).orderBy(desc(loans.createdAt));
  const out = [];
  for (const l of rows) out.push({ loan: l, outstandingPrincipal: sumOf(await scheduleOf(db, l.id), "principal") });
  return out;
}

/** ACTIVE / PAST_DUE status from the oldest unpaid installment; PAID when all are paid. */
async function refreshStatus(tx: Tx, loan: Loan, asOf: BusinessDate): Promise<LoanStatus> {
  if (!OPEN.includes(loan.status) && loan.status !== "PAID") return loan.status;
  const rows = await scheduleOf(tx, loan.id);
  const oldest = oldestUnpaid(rows);
  const status: LoanStatus = !oldest ? "PAID" : daysPastDue(oldest.dueDate, asOf) > 0 ? "PAST_DUE" : "ACTIVE";
  if (status !== loan.status) await tx.update(loans).set({ status, closedAt: status === "PAID" ? asOf : null }).where(eq(loans.id, loan.id));
  return status;
}

// ── Release (T11.2) ──

/**
 * Step 1 (loans.release, never the encoder or an approver): the loan is created PENDING from the
 * approved application, with its first due date. Cash proceeds are then paid out by a teller
 * (step 2); proceeds credited to the member's savings are released right away (CONFIRM Q-11.1).
 */
export async function authorizeRelease(tx: Tx, input: { applicationId: string; firstDueDate: BusinessDate; disbursement: Disbursement; savingsAccountId: string | null }, managerId: string) {
  const [app] = await tx.select().from(loanApplications).where(eq(loanApplications.id, input.applicationId)).for("update");
  if (!app) throw new LoanError("Loan application not found");
  if (app.status !== "APPROVED") throw new LoanError(`The application is ${app.status}; only an APPROVED application is released`);
  if (app.encodedBy === managerId) throw new LoanError("Segregation of duties: the loan officer who encoded it can't release it");
  const approvers = await tx.select({ by: loanApprovals.by }).from(loanApprovals).where(and(eq(loanApprovals.applicationId, app.id), eq(loanApprovals.decision, "APPROVE")));
  if (approvers.some((a) => a.by === managerId)) throw new LoanError("Segregation of duties: the release is authorized by someone other than the approver");
  const today = businessToday();
  if (input.firstDueDate <= today) throw new LoanError("The first due date must be after today");
  if (input.firstDueDate > addMonths(today, 3)) throw new LoanError("The first due date can be at most 3 months away");
  if (input.disbursement === "RESTRUCTURE") throw new LoanError("Choose cash or the member's savings");
  if (input.disbursement === "SAVINGS") {
    if (!input.savingsAccountId) throw new LoanError("Choose the savings account to credit");
    await checkTransferIn(tx, { accountId: input.savingsAccountId, memberId: app.memberId });
  }
  const loanNo = await nextNumber("LN", tx);
  const [loan] = await tx
    .insert(loans)
    .values({
      loanNo,
      applicationId: app.id,
      memberId: app.memberId,
      productId: app.productId,
      principal: app.amount,
      ratePm: app.ratePm,
      method: app.method,
      term: app.term,
      firstDueDate: input.firstDueDate,
      maturityDate: addMonths(input.firstDueDate, app.term - 1),
      disbursement: input.disbursement,
      savingsAccountId: input.disbursement === "SAVINGS" ? input.savingsAccountId : null,
      deductions: app.deductions,
      netProceeds: app.netProceeds,
      receivableGlKey: app.receivableGlKey,
      penaltyRatePm: app.penaltyRatePm,
      graceDays: app.graceDays,
      authorizedBy: managerId,
      createdBy: managerId,
    })
    .returning();
  if (!loan) throw new Error("loan insert returned no row");
  await tx.update(loanApplications).set({ status: "RELEASED" }).where(eq(loanApplications.id, app.id));
  await audit(tx, { action: "loans.release_authorize", entity: "loan", entityId: loan.id, after: { loanNo, appNo: app.appNo, principal: format(app.amount), firstDueDate: input.firstDueDate, disbursement: input.disbursement }, userId: managerId });
  if (input.disbursement === "SAVINGS") await release(tx, loan, managerId);
  return { loanId: loan.id, loanNo };
}

/** Step 2 for cash (a teller, from the drawer): the release entry with the net proceeds paid out. */
export async function payOutProceeds(tx: Tx, input: { loanId: string }, tellerId: string) {
  const loan = await lockLoan(tx, input.loanId);
  if (loan.status !== "PENDING" || loan.disbursement !== "CASH") throw new LoanError(`${loan.loanNo} is not waiting for a cash payout`);
  return release(tx, loan, tellerId);
}

/**
 * The release entry (DOMAIN §6): Dr Loans Receivable (principal) / Cr each deduction's account
 * (CBU through share capital) / Cr Cash or Savings Deposits (net). The schedule starts from the
 * first due date set at authorization.
 */
async function release(tx: Tx, loan: Loan, actorId: string) {
  const today = businessToday();
  if (loan.firstDueDate <= today) throw new LoanError(`The first due date (${formatDate(loan.firstDueDate)}) has passed; the release must be authorized again`);
  const [member] = await tx.select().from(members).where(eq(members.id, loan.memberId));
  if (!member) throw new LoanError("Member not found");
  const debitLines: LineInput[] = [{ accountId: await accountIdFor(loan.receivableGlKey, tx), debit: loan.principal, memberId: loan.memberId, memo: loan.loanNo }];
  const otherCredits: LineInput[] = [];
  let cbu = 0n;
  for (const d of loan.deductions) {
    const amount = BigInt(d.amount);
    if (amount === 0n) continue;
    if (d.code === "CBU") {
      cbu += amount;
      otherCredits.push(...(await cbuLines(tx, loan.memberId, amount)));
    } else {
      otherCredits.push({ accountId: await accountIdFor(d.glKey, tx), credit: amount, memo: `${d.name} · ${loan.loanNo}` });
    }
  }
  const particulars = `Loan release ${loan.loanNo} · ${member.memberNo} ${nameOf(member)} · ${format(loan.principal)}, net ${format(loan.netProceeds)}`;
  let jeId: string;
  if (loan.disbursement === "CASH") {
    ({ jeId } = await payOut(tx, { type: "LOAN_PROCEEDS", refId: loan.id, reference: loan.loanNo, particulars, amount: loan.netProceeds, debitLines, otherCredits, source: { module: "loans", id: loan.id } }, actorId));
  } else {
    const accountId = loan.savingsAccountId;
    if (!accountId) throw new LoanError("No savings account to credit");
    const je = await postJournal(tx, { date: today, book: "GJ", particulars, reference: loan.loanNo, source: { module: "loans", id: loan.id }, lines: [...debitLines, ...otherCredits, { accountId: await savingsGlAccountId(tx, accountId), credit: loan.netProceeds, memberId: loan.memberId, memo: loan.loanNo }] }, actorId);
    jeId = je.id;
    await recordTransfer(tx, { accountId, amount: loan.netProceeds, date: today, jeId, refNo: loan.loanNo, remarks: `Proceeds of loan ${loan.loanNo}` }, actorId);
  }
  if (cbu > 0n) await retainCbu(tx, loan.memberId, cbu, { jeId, ref: loan.loanNo }, actorId);
  await insertSchedule(tx, loan, loan.principal, loan.firstDueDate, loan.term, actorId);
  await tx.update(loans).set({ status: "ACTIVE", jeId, releaseDate: today, releasedBy: actorId }).where(eq(loans.id, loan.id));
  await audit(tx, { action: "loans.release", entity: "loan", entityId: loan.id, after: { loanNo: loan.loanNo, net: format(loan.netProceeds), disbursement: loan.disbursement, cbu: format(cbu) }, userId: actorId });
  return { jeId };
}

async function insertSchedule(tx: Tx, loan: Pick<Loan, "id" | "ratePm" | "method">, principal: Money, firstDueDate: BusinessDate, term: number, actorId: string) {
  const rows = schedule({ principal, ratePm: loan.ratePm, term, method: loan.method, firstDueDate });
  await tx.insert(loanSchedule).values(rows.map((r) => ({ loanId: loan.id, no: r.no, dueDate: r.dueDate, principalDue: r.principal, interestDue: r.interest, createdBy: actorId })));
}

// ── Payments (T11.3) ──

export type LoanPaymentPlan = { loanId: string; kind: PaymentKind; amount: Money; penalty: Money; interest: Money; principal: Money; allocations: PaymentAllocation[] };

/**
 * How a payment is spread (loan.payment_allocation: penalty → interest → principal, oldest
 * installment first; loan.excess_payment: the rest advances the next installments, schedule
 * unchanged). Locks the loan. A payment can't be more than everything still owed.
 */
export async function planLoanPayment(tx: Tx, loanId: string, amount: Money, kind: PaymentKind = "PAYMENT"): Promise<LoanPaymentPlan> {
  const loan = await lockLoan(tx, loanId);
  if (!OPEN.includes(loan.status)) throw new LoanError(`${loan.loanNo} is ${loan.status}; it takes no payments`);
  if (amount <= 0n) throw new LoanError("The amount must be more than zero");
  const rows = await scheduleOf(tx, loan.id);
  const owed = rows.reduce((s, r) => s + unpaidOf(r).penalty + unpaidOf(r).interest + unpaidOf(r).principal, 0n);
  if (amount > owed) throw new LoanError(`The payment is more than ${loan.loanNo} still owes (${format(owed)})`);
  const { order } = await getSetting("loan.payment_allocation", tx);
  let left = amount;
  const allocations: PaymentAllocation[] = [];
  const totals = { penalty: 0n, interest: 0n, principal: 0n };
  for (const r of rows) {
    if (left === 0n) break;
    const unpaid = unpaidOf(r);
    const part = { penalty: 0n, interest: 0n, principal: 0n };
    for (const component of order) {
      const k = component === "PENALTY" ? "penalty" : component === "INTEREST" ? "interest" : "principal";
      const take = unpaid[k] < left ? unpaid[k] : left;
      part[k] += take;
      left -= take;
    }
    if (part.penalty + part.interest + part.principal > 0n) {
      allocations.push({ no: r.no, penalty: String(part.penalty), interest: String(part.interest), principal: String(part.principal) });
      totals.penalty += part.penalty;
      totals.interest += part.interest;
      totals.principal += part.principal;
    }
  }
  return { loanId: loan.id, kind, amount, ...totals, allocations };
}

/** The credits of a loan payment: penalties and interest are income now; principal reduces the receivable. */
export async function loanPaymentLines(tx: Tx, plan: LoanPaymentPlan): Promise<LineInput[]> {
  const [loan] = await tx.select().from(loans).where(eq(loans.id, plan.loanId));
  if (!loan) throw new LoanError("Loan not found");
  const lines: LineInput[] = [];
  if (plan.penalty > 0n) lines.push({ accountId: await accountIdFor("fines_penalties_income", tx), credit: plan.penalty, memo: loan.loanNo });
  if (plan.interest > 0n) lines.push({ accountId: await accountIdFor("interest_income_loans", tx), credit: plan.interest, memo: loan.loanNo });
  if (plan.principal > 0n) lines.push({ accountId: await accountIdFor(loan.receivableGlKey, tx), credit: plan.principal, memberId: loan.memberId, memo: loan.loanNo });
  return lines;
}

/** Writes a payment (after its entry exists) and applies it to the installments. */
export async function recordLoanPayment(tx: Tx, plan: LoanPaymentPlan, ctx: { payDate: BusinessDate; jeId: string; refNo: string | null; birReceiptNo?: string | null; receiptItemId?: string | null; remarks?: string | null }, actorId: string | null) {
  const loan = await lockLoan(tx, plan.loanId);
  await tx.insert(loanPayments).values({
    loanId: loan.id,
    payDate: ctx.payDate,
    kind: plan.kind,
    amount: plan.amount,
    penaltyPart: plan.penalty,
    interestPart: plan.interest,
    principalPart: plan.principal,
    allocations: plan.allocations,
    refNo: ctx.refNo,
    birReceiptNo: ctx.birReceiptNo ?? null,
    receiptItemId: ctx.receiptItemId ?? null,
    jeId: ctx.jeId,
    remarks: ctx.remarks ?? null,
    createdBy: actorId,
  });
  await applyAllocations(tx, loan.id, plan.allocations, 1n);
  await refreshStatus(tx, loan, ctx.payDate);
}

/** Adds (+1) or takes back (−1) a payment's allocations on the installments and recomputes their status. */
async function applyAllocations(tx: Tx, loanId: string, allocations: PaymentAllocation[], sign: 1n | -1n) {
  for (const a of allocations) {
    const [r] = await tx.select().from(loanSchedule).where(and(eq(loanSchedule.loanId, loanId), eq(loanSchedule.no, a.no))).for("update");
    if (!r) throw new Error(`installment ${a.no} not found`);
    const next = {
      penaltyPaid: r.penaltyPaid + sign * BigInt(a.penalty),
      interestPaid: r.interestPaid + sign * BigInt(a.interest),
      principalPaid: r.principalPaid + sign * BigInt(a.principal),
    };
    const paidAll = next.principalPaid === r.principalDue && next.interestPaid === r.interestDue && next.penaltyPaid === r.penaltyAccrued;
    const nothing = next.principalPaid === 0n && next.interestPaid === 0n && next.penaltyPaid === 0n;
    await tx.update(loanSchedule).set({ ...next, status: paidAll ? "PAID" : nothing ? "OPEN" : "PARTIAL" }).where(eq(loanSchedule.id, r.id));
  }
}

async function paymentOfReceiptItem(tx: Tx, receiptItemId: string) {
  const [p] = await tx.select().from(loanPayments).where(eq(loanPayments.receiptItemId, receiptItemId));
  if (!p) throw new Error("loan payment of the receipt item not found");
  return p;
}

/** Before a payment's receipt is cancelled (locks the loan): only the latest payment on a loan can be taken back. */
export async function checkPaymentReversal(tx: Tx, receiptItemId: string): Promise<void> {
  const p = await paymentOfReceiptItem(tx, receiptItemId);
  const loan = await lockLoan(tx, p.loanId);
  if (loan.status === "RESTRUCTURED" || (loan.status === "WRITTEN_OFF" && p.kind !== "RECOVERY")) throw new LoanError(`${loan.loanNo} is ${loan.status}; its payments can't be taken back`);
  const [later] = await tx.select({ id: loanPayments.id }).from(loanPayments).where(and(eq(loanPayments.loanId, loan.id), isNull(loanPayments.reversedBy), sql`${loanPayments.seq} > ${p.seq}`)).limit(1);
  if (later) throw new LoanError(`${loan.loanNo} has later payments; cancel those first`);
}

/** After the reversal entry exists: the payment comes off the installments and is marked reversed. */
export async function reverseLoanPayment(tx: Tx, receiptItemId: string, reversalJeId: string, actorId: string): Promise<void> {
  await checkPaymentReversal(tx, receiptItemId);
  const p = await paymentOfReceiptItem(tx, receiptItemId);
  const loan = await lockLoan(tx, p.loanId);
  if (p.kind !== "RECOVERY") await applyAllocations(tx, loan.id, p.allocations, -1n);
  await tx.update(loanPayments).set({ reversedBy: reversalJeId }).where(eq(loanPayments.id, p.id));
  await refreshStatus(tx, loan, businessToday());
  await audit(tx, { action: "loans.payment_reverse", entity: "loan", entityId: loan.id, after: { amount: format(p.amount), refNo: p.refNo }, userId: actorId });
}

// ── Penalties and the daily job (T11.4) ──

/**
 * Penalties as of `date` (loan.penalty_rate_pm on the loan): on each installment more than
 * grace_days past due, the unpaid amount × rate × days ÷ 30, kept as Σ(unpaid × days) and rounded
 * once (HALF-UP), so daily runs and a catch-up run give the same total. A memo: no entry; it is
 * income when collected.
 */
export async function accruePenalties(tx: Tx, date: BusinessDate, actorId: string | null = null): Promise<{ accruals: number; amount: Money }> {
  const open = await tx.select().from(loans).where(inArray(loans.status, OPEN)).for("update");
  let count = 0;
  let total = 0n;
  for (const loan of open) {
    const rows = (await scheduleOf(tx, loan.id)).filter((r) => r.status !== "PAID" && r.dueDate < date);
    for (const r of rows) {
      const dpd = daysBetween(r.dueDate, date);
      if (dpd <= loan.graceDays) continue;
      const basis = r.principalDue - r.principalPaid + (r.interestDue - r.interestPaid);
      if (basis <= 0n) continue;
      const prior = await tx
        .select({
          amount: sql<string>`coalesce(sum(${loanPenaltyAccruals.amount}), 0)::text`,
          basisDays: sql<string>`coalesce(sum(${loanPenaltyAccruals.basis} * ${loanPenaltyAccruals.days}), 0)::text`,
          last: sql<string | null>`max(${loanPenaltyAccruals.businessDate})::text`,
        })
        .from(loanPenaltyAccruals)
        .where(and(eq(loanPenaltyAccruals.loanId, loan.id), eq(loanPenaltyAccruals.scheduleNo, r.no)));
      const last = prior[0]?.last ?? null;
      // The first accrual counts every day since the due date; later ones the days since the last.
      const days = last ? daysBetween(last, date) : dpd;
      if (days <= 0) continue;
      const basisDays = BigInt(prior[0]?.basisDays ?? "0") + basis * BigInt(days);
      const amount = penaltyToDate(basisDays, loan.penaltyRatePm) - BigInt(prior[0]?.amount ?? "0");
      const accrued = amount > 0n ? amount : 0n;
      await tx.insert(loanPenaltyAccruals).values({ loanId: loan.id, scheduleNo: r.no, businessDate: date, amount: accrued, basis, days, createdBy: actorId });
      if (accrued > 0n) {
        await tx.update(loanSchedule).set({ penaltyAccrued: r.penaltyAccrued + accrued }).where(eq(loanSchedule.id, r.id));
        count += 1;
        total += accrued;
      }
    }
  }
  return { accruals: count, amount: total };
}

/** Today's aging per open loan, for the snapshot and the reports. */
export async function portfolio(asOf: BusinessDate, db: Db | Tx = getDb()) {
  const buckets = await getSetting("loan.aging_buckets", db);
  const rows = await db.select({ loan: loans, member: members }).from(loans).innerJoin(members, eq(members.id, loans.memberId)).where(inArray(loans.status, OPEN)).orderBy(asc(loans.loanNo));
  const out = [];
  for (const { loan, member } of rows) {
    const sched = await scheduleOf(db, loan.id);
    const oldest = oldestUnpaid(sched);
    const dpd = daysPastDue(oldest?.dueDate ?? null, asOf);
    const pastDueRows = sched.filter((r) => r.status !== "PAID" && r.dueDate < asOf);
    out.push({
      loan,
      member,
      outstandingPrincipal: sumOf(sched, "principal"),
      daysPastDue: dpd,
      bucket: bucketFor(dpd, buckets),
      amountPastDue: pastDueRows.reduce((s, r) => s + unpaidOf(r).penalty + unpaidOf(r).interest + unpaidOf(r).principal, 0n),
    });
  }
  return out;
}

/**
 * The daily job (registered with the cron runner, once per business date): penalties, loan
 * statuses (ACTIVE / PAST_DUE) and the aging snapshot.
 */
export async function loansDaily(tx: Tx, date: BusinessDate) {
  const penalties = await accruePenalties(tx, date);
  const open = await tx.select().from(loans).where(inArray(loans.status, OPEN));
  for (const loan of open) await refreshStatus(tx, loan, date);
  const rows = await portfolio(date, tx);
  if (rows.length) {
    await tx
      .insert(loanAgingSnapshots)
      .values(rows.map((r) => ({ asOf: date, loanId: r.loan.id, daysPastDue: r.daysPastDue, bucket: r.bucket, outstandingPrincipal: r.outstandingPrincipal })))
      .onConflictDoNothing();
  }
  return { penalties: penalties.accruals, penaltyAmount: String(penalties.amount), loans: rows.length };
}

// ── Aging, PAR and delinquency (T11.5) ──

/** Loans past due with what is overdue, the borrower's and the comakers' contact numbers. */
export async function delinquencyList(asOf: BusinessDate, db: Db | Tx = getDb()) {
  const rows = (await portfolio(asOf, db)).filter((r) => r.daysPastDue > 0).sort((a, b) => b.daysPastDue - a.daysPastDue);
  const out = [];
  for (const r of rows) {
    const comakers = r.loan.applicationId
      ? await db
          .select({ name: sql<string>`${members.lastName} || ', ' || ${members.firstName}`, memberNo: members.memberNo, mobile: members.mobile })
          .from(loanApplicationComakers)
          .innerJoin(members, eq(members.id, loanApplicationComakers.memberId))
          .where(eq(loanApplicationComakers.applicationId, r.loan.applicationId))
      : [];
    out.push({ ...r, comakers });
  }
  return out;
}

// ── Write-off, recovery and restructure (T11.6) ──

/** Writes off the outstanding principal (Board resolution required): Dr Allowance for Probable Losses / Cr Loans Receivable. */
export async function writeOff(tx: Tx, input: { loanId: string; bodRef: string; reason: string }, managerId: string) {
  const bodRef = input.bodRef.trim();
  if (!bodRef) throw new LoanError("Enter the Board resolution no. that approved the write-off");
  const reason = input.reason.trim();
  if (!reason) throw new LoanError("Enter the reason for the write-off");
  const loan = await lockLoan(tx, input.loanId);
  if (!OPEN.includes(loan.status)) throw new LoanError(`${loan.loanNo} is ${loan.status}`);
  const outstanding = sumOf(await scheduleOf(tx, loan.id), "principal");
  if (outstanding <= 0n) throw new LoanError(`${loan.loanNo} has no principal left to write off`);
  const je = await postJournal(
    tx,
    {
      date: businessToday(),
      book: "GJ",
      particulars: `Write-off of loan ${loan.loanNo} (${bodRef}): ${reason}`,
      reference: bodRef,
      source: { module: "loans", id: loan.id },
      lines: [
        { accountId: await accountIdFor("allowance_probable_losses", tx), debit: outstanding, memberId: loan.memberId, memo: loan.loanNo },
        { accountId: await accountIdFor(loan.receivableGlKey, tx), credit: outstanding, memberId: loan.memberId, memo: loan.loanNo },
      ],
    },
    managerId,
  );
  await tx.update(loans).set({ status: "WRITTEN_OFF", writeOffRef: bodRef, writeOffJeId: je.id, closedAt: businessToday() }).where(eq(loans.id, loan.id));
  await audit(tx, { action: "loans.write_off", entity: "loan", entityId: loan.id, after: { loanNo: loan.loanNo, principal: format(outstanding), bodRef, reason }, userId: managerId });
  return { jeId: je.id, amount: outstanding };
}

/** What can still be recovered on a written-off loan: the principal written off less recoveries so far. */
export async function recoverable(db: Db | Tx, loanId: string): Promise<Money> {
  const written = sumOf(await scheduleOf(db, loanId), "principal");
  const [rec] = await db.select({ s: sql<string>`coalesce(sum(${loanPayments.amount}), 0)::text` }).from(loanPayments).where(and(eq(loanPayments.loanId, loanId), eq(loanPayments.kind, "RECOVERY"), isNull(loanPayments.reversedBy)));
  return written - BigInt(rec?.s ?? "0");
}

/** A collection on a written-off loan: income (Cr Recovery of Loans Written Off, CONFIRM Q-11.4). */
export async function planRecovery(tx: Tx, loanId: string, amount: Money): Promise<LoanPaymentPlan> {
  const loan = await lockLoan(tx, loanId);
  if (loan.status !== "WRITTEN_OFF") throw new LoanError(`${loan.loanNo} is not written off`);
  if (amount <= 0n) throw new LoanError("The amount must be more than zero");
  const left = await recoverable(tx, loan.id);
  if (amount > left) throw new LoanError(`Only ${format(left)} of ${loan.loanNo} is left to recover`);
  return { loanId: loan.id, kind: "RECOVERY", amount, penalty: 0n, interest: 0n, principal: 0n, allocations: [] };
}

export async function recoveryLines(tx: Tx, plan: LoanPaymentPlan): Promise<LineInput[]> {
  const [loan] = await tx.select({ loanNo: loans.loanNo }).from(loans).where(eq(loans.id, plan.loanId));
  return [{ accountId: await accountIdFor("recovery_income_loans", tx), credit: plan.amount, memo: `Recovery · ${loan?.loanNo ?? ""}` }];
}

/**
 * Restructure (CONFIRM Q-11.5): the old loan's outstanding principal, the unpaid interest of
 * installments already due and the unpaid penalties become a new loan (same rate and method, a new
 * term and schedule); the old loan is RESTRUCTURED and linked. GL: Dr Loans Receivable (new) / Cr
 * Loans Receivable (old principal) / Cr Interest Income / Cr Fines and Penalties Income.
 */
export async function restructure(tx: Tx, input: { loanId: string; term: number; firstDueDate: BusinessDate; reason: string }, managerId: string) {
  const old = await lockLoan(tx, input.loanId);
  if (!OPEN.includes(old.status)) throw new LoanError(`${old.loanNo} is ${old.status}`);
  const reason = input.reason.trim();
  if (!reason) throw new LoanError("Enter why the loan is restructured (e.g. the Board resolution)");
  if (!Number.isInteger(input.term) || input.term < 1 || input.term > 360) throw new LoanError("Enter the new term in months (1 to 360)");
  const today = businessToday();
  if (input.firstDueDate <= today || input.firstDueDate > addMonths(today, 3)) throw new LoanError("The first due date must be after today and at most 3 months away");
  const rows = await scheduleOf(tx, old.id);
  const principal = sumOf(rows, "principal");
  const interest = rows.filter((r) => r.dueDate <= today).reduce((s, r) => s + unpaidOf(r).interest, 0n);
  const penalty = sumOf(rows, "penalty");
  const total = principal + interest + penalty;
  if (total <= 0n) throw new LoanError(`${old.loanNo} has nothing left to restructure`);
  const loanNo = await nextNumber("LN", tx);
  const receivable = await accountIdFor(old.receivableGlKey, tx);
  const je = await postJournal(
    tx,
    {
      date: today,
      book: "GJ",
      particulars: `Restructure of loan ${old.loanNo} into ${loanNo}: ${reason}`,
      reference: loanNo,
      source: { module: "loans", id: old.id },
      lines: [
        { accountId: receivable, debit: total, memberId: old.memberId, memo: loanNo },
        { accountId: receivable, credit: principal, memberId: old.memberId, memo: old.loanNo },
        ...(interest > 0n ? [{ accountId: await accountIdFor("interest_income_loans", tx), credit: interest, memo: `${old.loanNo} interest capitalized` }] : []),
        ...(penalty > 0n ? [{ accountId: await accountIdFor("fines_penalties_income", tx), credit: penalty, memo: `${old.loanNo} penalties capitalized` }] : []),
      ],
    },
    managerId,
  );
  const [loan] = await tx
    .insert(loans)
    .values({
      loanNo,
      memberId: old.memberId,
      productId: old.productId,
      principal: total,
      ratePm: old.ratePm,
      method: old.method,
      term: input.term,
      releaseDate: today,
      firstDueDate: input.firstDueDate,
      maturityDate: addMonths(input.firstDueDate, input.term - 1),
      status: "ACTIVE",
      disbursement: "RESTRUCTURE",
      deductions: [],
      netProceeds: 0n,
      receivableGlKey: old.receivableGlKey,
      penaltyRatePm: old.penaltyRatePm,
      graceDays: old.graceDays,
      authorizedBy: managerId,
      releasedBy: managerId,
      jeId: je.id,
      restructuredFromId: old.id,
      createdBy: managerId,
    })
    .returning();
  if (!loan) throw new Error("loan insert returned no row");
  await insertSchedule(tx, loan, total, input.firstDueDate, input.term, managerId);
  await tx.update(loans).set({ status: "RESTRUCTURED", closedAt: today }).where(eq(loans.id, old.id));
  await audit(tx, { action: "loans.restructure", entity: "loan", entityId: old.id, after: { into: loanNo, principal: format(principal), interest: format(interest), penalty: format(penalty), term: input.term, reason }, userId: managerId });
  return { loanId: loan.id, loanNo, principal: total };
}

// ── Offsets (termination) and payments from savings (T11.6) ──

/** Pays a loan from the member's savings: Dr Savings Deposits / Cr penalties, interest, Loans Receivable. */
export async function payFromSavings(tx: Tx, input: { loanId: string; accountId: string; amount: Money }, actorId: string) {
  const plan = await planLoanPayment(tx, input.loanId, input.amount, "OFFSET");
  const [loan] = await tx.select().from(loans).where(eq(loans.id, input.loanId));
  if (!loan) throw new LoanError("Loan not found");
  await checkTransferOut(tx, { accountId: input.accountId, memberId: loan.memberId, amount: input.amount });
  const today = businessToday();
  const je = await postJournal(
    tx,
    {
      date: today,
      book: "GJ",
      particulars: `Loan ${loan.loanNo} paid from savings`,
      reference: loan.loanNo,
      source: { module: "loans", id: loan.id },
      lines: [{ accountId: await savingsGlAccountId(tx, input.accountId), debit: input.amount, memberId: loan.memberId, memo: loan.loanNo }, ...(await loanPaymentLines(tx, plan))],
    },
    actorId,
  );
  await recordTransfer(tx, { accountId: input.accountId, amount: -input.amount, date: today, jeId: je.id, refNo: loan.loanNo, remarks: `Payment of loan ${loan.loanNo}` }, actorId);
  await recordLoanPayment(tx, plan, { payDate: today, jeId: je.id, refNo: loan.loanNo, remarks: "Paid from savings" }, actorId);
  await audit(tx, { action: "loans.pay_from_savings", entity: "loan", entityId: loan.id, after: { amount: format(input.amount), interest: format(plan.interest), principal: format(plan.principal) }, userId: actorId });
  return { jeId: je.id };
}

/** Plans of a share-capital withdrawal's offsets, kept until its entry is posted. */
const pendingOffsets = new WeakMap<Tx, LoanPaymentPlan[]>();

registerShareOffset({
  name: "loans",
  // On a member's share-capital withdrawal (termination), paid-up capital pays their open loans first.
  lines: async (tx, memberId, available) => {
    const open = await tx.select().from(loans).where(and(eq(loans.memberId, memberId), inArray(loans.status, OPEN))).orderBy(asc(loans.createdAt));
    const plans: LoanPaymentPlan[] = [];
    const lines: LineInput[] = [];
    let left = available;
    for (const loan of open) {
      if (left <= 0n) break;
      const rows = await scheduleOf(tx, loan.id);
      const owed = rows.reduce((s, r) => s + unpaidOf(r).penalty + unpaidOf(r).interest + unpaidOf(r).principal, 0n);
      const amount = owed < left ? owed : left;
      if (amount <= 0n) continue;
      const plan = await planLoanPayment(tx, loan.id, amount, "OFFSET");
      plans.push(plan);
      lines.push(...(await loanPaymentLines(tx, plan)));
      left -= amount;
    }
    pendingOffsets.set(tx, plans);
    const used = available - left;
    return { amount: used, lines, description: "Loans paid from share capital" };
  },
  recorded: async (tx, _memberId, jeId) => {
    for (const plan of pendingOffsets.get(tx) ?? []) await recordLoanPayment(tx, plan, { payDate: businessToday(), jeId, refNo: null, remarks: "Offset from share capital on withdrawal" }, null);
    pendingOffsets.delete(tx);
  },
});

/** Eligibility rules 4 and 5 (Phase 10 hook): a member with an overdue installment on an open loan. */
registerPastDueHook("loans", async (db, memberId) => {
  const today = businessToday();
  const rows = await db
    .select({ loanNo: loans.loanNo, due: sql<string>`min(${loanSchedule.dueDate})::text` })
    .from(loans)
    .innerJoin(loanSchedule, eq(loanSchedule.loanId, loans.id))
    .where(and(eq(loans.memberId, memberId), inArray(loans.status, OPEN), sql`${loanSchedule.status} <> 'PAID'`, lt(loanSchedule.dueDate, today)))
    .groupBy(loans.loanNo)
    .orderBy(asc(loans.loanNo));
  if (rows.length === 0) return null;
  return `has a past-due loan (${rows.map((r) => `${r.loanNo}, ${daysPastDue(r.due, today)} days`).join("; ")})`;
});

registerTerminationRule({
  name: "loans",
  check: async (memberId, db) => {
    const open = await db
      .select({ loanNo: loans.loanNo })
      .from(loans)
      .where(and(eq(loans.memberId, memberId), inArray(loans.status, ["PENDING", "ACTIVE", "PAST_DUE"])))
      .orderBy(asc(loans.loanNo));
    if (open.length === 0) return null;
    return `all loans must be paid or settled first (${open.map((l) => l.loanNo).join(", ")})`;
  },
});

/** Loans waiting for their release (approved applications) and their cash payout (Releases & collections page). */
export async function releaseQueue(db: Db | Tx = getDb()) {
  const approved = await db
    .select({ app: loanApplications, member: members })
    .from(loanApplications)
    .innerJoin(members, eq(members.id, loanApplications.memberId))
    .where(eq(loanApplications.status, "APPROVED"))
    .orderBy(asc(loanApplications.createdAt));
  const pending = await db.select({ loan: loans, member: members }).from(loans).innerJoin(members, eq(members.id, loans.memberId)).where(eq(loans.status, "PENDING")).orderBy(asc(loans.createdAt));
  const recent = await db
    .select({ loan: loans, member: members })
    .from(loans)
    .innerJoin(members, eq(members.id, loans.memberId))
    .where(and(inArray(loans.status, ["ACTIVE", "PAST_DUE"]), lte(loans.releaseDate, businessToday())))
    .orderBy(desc(loans.releaseDate))
    .limit(50);
  return { approved, pending, recent };
}
