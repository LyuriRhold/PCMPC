import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { runDailyJobs } from "@/lib/cron";
import { addDays, setClock } from "@/lib/dates";
import { format } from "@/lib/money";
import { cancelReceiptAction } from "@/modules/cashiering/actions";
import { duesFor } from "@/modules/cashiering/registry";
import { cashOuts, receipts } from "@/modules/cashiering/schema";
import { journalLines } from "@/modules/ledger/schema";
import { accountIdFor, subsidiaryLedger, trialBalance } from "@/modules/ledger/service";
import { decideApplicationAction, submitApplicationAction } from "@/modules/loans/actions";
import { loanAgingSnapshots, loanPenaltyAccruals } from "@/modules/loans/schema";
import { loanProductByCode } from "@/modules/loans/service";
import { authorizeReleaseAction, payFromSavingsAction, payOutProceedsAction, restructureAction, writeOffAction } from "@/modules/loans/servicing-actions";
import { delinquencyList, getLoan, portfolio } from "@/modules/loans/servicing";
import { canTerminate } from "@/modules/members/termination";
import { openAccountAction } from "@/modules/savings/actions";
import { accountBalance, productByCode as savingsProduct } from "@/modules/savings/service";
import { approveWithdrawalAction, withdrawSharesAction } from "@/modules/share/actions";
import { shareBalance } from "@/modules/share/service";
import { makeUser } from "../helpers/phase01";
import { P } from "../helpers/phase03";
import { goodStanding, member, on, payLoan, people, receipt, releasedLoan, setupServicing, tellerToday } from "../helpers/phase11";

beforeEach(async () => {
  on("2026-01-15");
  await setupServicing();
});
afterEach(() => setClock(null));

const release = (o: Partial<Parameters<typeof releasedLoan>[0]> = {}) => releasedLoan({ firstDueDate: "2026-02-15", ...o });

/** An approved (not yet released) application for a good-standing member. */
async function approvedApplication(product: "REG" | "EMR" | "PRD" = "EMR", amount = "5,000.00", term = 6) {
  const m = await member("Borrower");
  await goodStanding(m);
  const p = (await loanProductByCode(product))!;
  const comakers = p.requiredComakers ? [await member("Comaker")] : [];
  const app = await runAs(people().officer, () => submitApplicationAction({ memberId: m, productId: p.id, amount, term, purpose: "Capital", comakerIds: comakers }));
  if (!app.ok) throw new Error(app.error);
  const d = await runAs(people().manager, () => decideApplicationAction({ applicationId: app.data.id, decision: "APPROVE", remarks: "" }));
  if (!d.ok) throw new Error(d.error);
  return { memberId: m, applicationId: app.data.id };
}

describe("T11.2 release", () => {
  it("authorized by someone other than the approver, with a first due date after today and within 3 months", async () => {
    const a = await approvedApplication();
    expect(await runAs(people().manager, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "CASH", savingsAccountId: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/someone other than the approver/) });
    await expect(runAs(people().officer, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "CASH", savingsAccountId: null }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-01-15", disbursement: "CASH", savingsAccountId: null }))).toMatchObject({ ok: false, error: "The first due date must be after today" });
    expect(await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-04-16", disbursement: "CASH", savingsAccountId: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/at most 3 months/) });
    const ok = await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "CASH", savingsAccountId: null }));
    expect(ok).toMatchObject({ ok: true, data: { loanNo: expect.stringMatching(/^LN-2026-\d{5}$/) } });
    expect(await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "CASH", savingsAccountId: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/RELEASED/) });
  });

  it("a PENDING loan blocks termination; the teller pays it out once, from a drawer holding the net proceeds", async () => {
    const a = await approvedApplication();
    const auth = await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "CASH", savingsAccountId: null }));
    if (!auth.ok) throw new Error(auth.error);
    expect((await canTerminate(a.memberId, getDb())).reasons).toContain(`all loans must be paid or settled first (${auth.data.loanNo})`);
    const empty = (await makeUser("TELLER", "emptyloans")).id;
    const { openSessionAs } = await import("../helpers/phase04");
    await openSessionAs(empty, "0");
    expect(await runAs(empty, () => payOutProceedsAction({ loanId: auth.data.loanId }))).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough cash in the drawer/) });
    const paid = await runAs(await tellerToday(), () => payOutProceedsAction({ loanId: auth.data.loanId }));
    if (!paid.ok) throw new Error(paid.error);
    const outs = await getDb().select().from(cashOuts).where(eq(cashOuts.type, "LOAN_PROCEEDS"));
    expect(outs.map((o) => o.amount)).toEqual([P(4950)]);
    expect(await runAs(await tellerToday(), () => payOutProceedsAction({ loanId: auth.data.loanId }))).toMatchObject({ ok: false, error: expect.stringMatching(/not waiting for a cash payout/) });
  });

  it("proceeds credited to savings are released at once (no cash): Cr Savings Deposits; the passbook shows them", async () => {
    const a = await approvedApplication();
    const sav = await runAs(await tellerToday(), async () => openAccountAction({ memberId: a.memberId, productId: (await savingsProduct("SAV"))!.id }));
    if (!sav.ok) throw new Error(sav.error);
    const auth = await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-02-15", disbursement: "SAVINGS", savingsAccountId: sav.data.id }));
    if (!auth.ok) throw new Error(auth.error);
    const loan = (await getLoan(auth.data.loanId))!;
    expect(loan.loan.status).toBe("ACTIVE");
    expect(await accountBalance(sav.data.id)).toBe(P(4950));
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, loan.loan.jeId!));
    const savingsGl = await accountIdFor("savings_deposits");
    expect(lines.filter((l) => l.accountId === savingsGl).reduce((s, l) => s + l.credit, 0n)).toBe(P(4950));
  });

  it("a cash payout after the first due date is refused (authorize again)", async () => {
    const a = await approvedApplication();
    const auth = await runAs(people().manager2, () => authorizeReleaseAction({ applicationId: a.applicationId, firstDueDate: "2026-01-20", disbursement: "CASH", savingsAccountId: null }));
    if (!auth.ok) throw new Error(auth.error);
    on("2026-01-20");
    expect(await runAs(await tellerToday(), () => payOutProceedsAction({ loanId: auth.data.loanId }))).toMatchObject({ ok: false, error: expect.stringMatching(/first due date .* has passed/) });
  });
});

describe("T11.3 payments", () => {
  it("can't pay more than what is owed; one payment per loan per receipt; not another member's loan", async () => {
    const l = await release();
    on("2026-02-15");
    expect(await payLoan(l.memberId, l.loanId, "11,001.62")).toMatchObject({ ok: false, error: expect.stringMatching(/more than LN-.* still owes \(₱11,001\.61\)/) });
    expect(await receipt(l.memberId, [{ type: "LOAN_PAYMENT", amount: "100.00", refId: l.loanId }, { type: "LOAN_PAYMENT", amount: "100.00", refId: l.loanId }])).toMatchObject({ ok: false, error: "Put one payment per loan on a receipt" });
    const other = await member("Other");
    expect(await payLoan(other, l.loanId, "100.00")).toMatchObject({ ok: false, error: expect.stringMatching(/another member's loan/) });
  });

  it("payments are taken back newest first; a PAID loan reopens when its last payment is reversed", async () => {
    const l = await release();
    on("2026-02-15");
    const first = await payLoan(l.memberId, l.loanId, "1,000.00");
    const last = await payLoan(l.memberId, l.loanId, "10,001.61");
    if (!first.ok || !last.ok) throw new Error("payments failed");
    expect((await getLoan(l.loanId))!.loan.status).toBe("PAID");
    expect(await runAs(people().manager, () => cancelReceiptAction({ receiptId: first.data.id, reason: "x" }))).toMatchObject({ ok: false, error: expect.stringMatching(/later payments; cancel those first/) });
    expect((await runAs(people().manager, () => cancelReceiptAction({ receiptId: last.data.id, reason: "Bounced" }))).ok).toBe(true);
    const loan = (await getLoan(l.loanId))!;
    expect(loan.loan.status).toBe("ACTIVE");
    // ₱1,000.00 paid inst 1 (150.00 + 766.80) and ₱83.20 of inst 2's interest.
    expect(loan.outstandingPrincipal).toBe(P(9233, 20));
  });

  it("the teller sees what is due now, or the next installment", async () => {
    const l = await release();
    const dues = await duesFor(getDb(), { type: "MEMBER", id: l.memberId, name: "" });
    expect(dues.find((d) => d.type === "LOAN_PAYMENT")).toMatchObject({ refId: l.loanId, amount: P(916, 80), description: expect.stringMatching(/^Loan LN-\d{4}-\d{5} · next installment 2026-02-15$/) });
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    const later = await duesFor(getDb(), { type: "MEMBER", id: l.memberId, name: "" });
    expect(later.find((d) => d.type === "LOAN_PAYMENT")).toMatchObject({ amount: P(916, 80) * 2n + P(18, 34), description: expect.stringMatching(/due now, 30 days past due incl\. penalties/) });
  });
});

describe("T11.4 penalties and the daily job", () => {
  it("no penalty within the 3 grace days; running the job every day gives the same total as one catch-up run", async () => {
    const l = await release();
    for (let d = "2026-02-16"; d <= "2026-03-17"; d = addDays(d, 1)) {
      on(d);
      await runDailyJobs(d);
      if (d === "2026-02-18") expect((await getLoan(l.loanId))!.schedule[0]?.penaltyAccrued).toBe(0n);
    }
    expect((await getLoan(l.loanId))!.schedule[0]?.penaltyAccrued).toBe(P(18, 34));
  });

  it("a partial payment lowers the base going forward; paying restores ACTIVE", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    expect((await getLoan(l.loanId))!.loan.status).toBe("PAST_DUE");
    // ₱18.34 penalty + ₱150 interest + ₱300 principal: ₱466.80 of inst 1 left.
    expect((await payLoan(l.memberId, l.loanId, "468.34")).ok).toBe(true);
    on("2026-03-27");
    await runDailyJobs("2026-03-27");
    const accruals = await getDb().select().from(loanPenaltyAccruals).where(eq(loanPenaltyAccruals.loanId, l.loanId));
    // Inst 1: 10 more days on ₱466.80 → Σ = 916.80×30 + 466.80×10 = 32,172 pesos-days × 2% ÷ 30 = 21.448 → 21.45; 21.45 − 18.34 = 3.11.
    expect(accruals.filter((a) => a.scheduleNo === 1).map((a) => a.amount)).toEqual([P(18, 34), P(3, 11)]);
    const loan = (await getLoan(l.loanId))!;
    expect((await payLoan(l.memberId, l.loanId, format(loan.dueNow).replace("₱", ""))).ok).toBe(true);
    expect((await getLoan(l.loanId))!.loan.status).toBe("ACTIVE");
  });
});

describe("T11.5 aging, PAR and delinquency", () => {
  it("the delinquency list shows days past due, the amount overdue, the borrower's and comakers' mobile numbers; the job keeps a snapshot", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    const [row] = await delinquencyList("2026-03-17");
    expect(row).toMatchObject({ daysPastDue: 30, bucket: "1–30", outstandingPrincipal: P(10000), amountPastDue: P(916, 80) * 2n + P(18, 34) });
    expect(row?.member.mobile).toBeTruthy();
    expect(row?.comakers).toHaveLength(1);
    expect(row?.comakers[0]?.mobile).toBeTruthy();
    const snaps = await getDb().select().from(loanAgingSnapshots).where(eq(loanAgingSnapshots.loanId, l.loanId));
    expect(snaps.map((s) => [s.asOf, s.daysPastDue, s.bucket])).toEqual([["2026-03-17", 30, "1–30"]]);
    expect((await portfolio("2026-03-17")).length).toBe(1);
  });
});

describe("T11.6 write-off, recovery, restructure, offsets", () => {
  it("after a write-off, payments are recoveries (income), up to the principal written off", async () => {
    const l = await release();
    on("2026-02-15");
    const w = await runAs(people().manager, () => writeOffAction({ loanId: l.loanId, bodRef: "BOD 9", reason: "Absconded" }));
    expect(w.ok).toBe(true);
    expect(await payLoan(l.memberId, l.loanId, "10,000.01")).toMatchObject({ ok: false, error: expect.stringMatching(/Only ₱10,000\.00 of LN-.* is left to recover/) });
    const r = await payLoan(l.memberId, l.loanId, "1,000.00");
    if (!r.ok) throw new Error(r.error);
    const [rc] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, rc!.jeId));
    const rec = await accountIdFor("recovery_income_loans");
    expect(lines.filter((x) => x.accountId === rec).reduce((s, x) => s + x.credit, 0n)).toBe(P(1000));
    expect((await getLoan(l.loanId))!.payments.at(-1)).toMatchObject({ kind: "RECOVERY", amount: P(1000) });
  });

  it("restructure: outstanding principal + interest due + penalties become a new loan; the old one is RESTRUCTURED", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    const r = await runAs(people().manager, () => restructureAction({ loanId: l.loanId, term: 12, firstDueDate: "2026-04-17", reason: "BOD 2026-50: hardship" }));
    if (!r.ok) throw new Error(r.error);
    const old = (await getLoan(l.loanId))!;
    const fresh = (await getLoan(r.data.loanId))!;
    expect(old.loan.status).toBe("RESTRUCTURED");
    expect(old.restructuredInto?.loanNo).toBe(r.data.loanNo);
    // ₱10,000.00 principal + interest of inst 1 and 2 (150.00 + 138.50) + penalty 18.34.
    expect(fresh.loan).toMatchObject({ principal: P(10306, 84), status: "ACTIVE", restructuredFromId: l.loanId, disbursement: "RESTRUCTURE" });
    expect(fresh.schedule).toHaveLength(12);
    expect((await subsidiaryLedger("loans_receivable_REG", l.memberId, "2026-01-01", "2026-12-31")).closing).toBe(P(10306, 84));
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("on termination the member's paid-up capital pays the loan first; the rest is paid out", async () => {
    const l = await release();
    on("2026-02-15");
    // Paid-up ₱2,700 (₱2,500 + ₱200 CBU) pays penalties/interest/principal oldest first.
    expect((await runAs(people().manager, () => approveWithdrawalAction({ memberId: l.memberId, reason: "Resignation", bodRef: "BOD 77" }))).ok).toBe(true);
    const w = await runAs(await tellerToday(), () => withdrawSharesAction({ memberId: l.memberId }));
    if (!w.ok) throw new Error(w.error);
    expect(w.data.cash).toBe("0");
    const loan = (await getLoan(l.loanId))!;
    expect(loan.payments.map((p) => [p.kind, p.amount])).toEqual([["OFFSET", P(2700)]]);
    expect(loan.schedule.slice(0, 2).map((r) => r.status)).toEqual(["PAID", "PAID"]);
    expect((await shareBalance(l.memberId)).paidUp).toBe(0n);
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("a loan can be paid from the member's savings (keeping the maintaining balance)", async () => {
    const l = await release();
    const sav = await runAs(await tellerToday(), async () => openAccountAction({ memberId: l.memberId, productId: (await savingsProduct("SAV"))!.id }));
    if (!sav.ok) throw new Error(sav.error);
    expect((await receipt(l.memberId, [{ type: "SAVINGS_DEPOSIT", amount: "1,000.00", refId: sav.data.id }])).ok).toBe(true);
    expect(await runAs(await tellerToday(), () => payFromSavingsAction({ loanId: l.loanId, accountId: sav.data.id, amount: "916.80" }))).toMatchObject({ ok: false, error: expect.stringMatching(/at most ₱900\.00 can be used/) });
    expect((await runAs(await tellerToday(), () => payFromSavingsAction({ loanId: l.loanId, accountId: sav.data.id, amount: "900.00" }))).ok).toBe(true);
    expect(await accountBalance(sav.data.id)).toBe(P(100));
    expect((await getLoan(l.loanId))!.schedule[0]).toMatchObject({ interestPaid: P(150), principalPaid: P(750), status: "PARTIAL" });
  });
});

describe("data rules", () => {
  it("a loan's terms, its installments' due amounts, payments and accruals can't be changed", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    const pool = getPool();
    await expect(pool.query("UPDATE loans SET principal = 1 WHERE id = $1", [l.loanId])).rejects.toThrow(/only the status, release, write-off and closing fields can change/);
    await expect(pool.query("UPDATE loan_schedule SET principal_due = 1 WHERE loan_id = $1", [l.loanId])).rejects.toThrow(/due date and amounts can't change/);
    await expect(pool.query("DELETE FROM loan_penalty_accruals WHERE loan_id = $1", [l.loanId])).rejects.toThrow(/immutable/);
    expect((await payLoan(l.memberId, l.loanId, "100.00")).ok).toBe(true);
    await expect(pool.query("UPDATE loan_payments SET amount = 1 WHERE loan_id = $1", [l.loanId])).rejects.toThrow(/only a reversal is recorded/);
    await expect(pool.query("DELETE FROM loans WHERE id = $1", [l.loanId])).rejects.toThrow(/can't be deleted/);
  });
});
