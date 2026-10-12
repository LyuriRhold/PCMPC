import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { runDailyJobs } from "@/lib/cron";
import { setClock } from "@/lib/dates";
import { cancelReceiptAction } from "@/modules/cashiering/actions";
import { receipts } from "@/modules/cashiering/schema";
import { journalLines } from "@/modules/ledger/schema";
import { accountIdFor } from "@/modules/ledger/service";
import { submitApplicationAction } from "@/modules/loans/actions";
import { bucketFor, daysPastDue, parPercent } from "@/modules/loans/aging";
import { schedule } from "@/modules/loans/amortization";
import { loanPenaltyAccruals } from "@/modules/loans/schema";
import { loanProductByCode } from "@/modules/loans/service";
import { writeOffAction } from "@/modules/loans/servicing-actions";
import { getLoan } from "@/modules/loans/servicing";
import { canTerminate } from "@/modules/members/termination";
import { openAccountAction } from "@/modules/savings/actions";
import { accountBalance } from "@/modules/savings/service";
import { membershipFeePaid, shareBalance } from "@/modules/share/service";
import { getSetting } from "@/modules/settings/service";
import { billBalances } from "@/modules/water/collections";
import { P } from "../helpers/phase03";
import { activeAccount } from "../helpers/phase06";
import { billMonth } from "../helpers/phase07";
import { goodStanding, member, on, payLoan, people, receipt, releasedLoan, setupServicing, tellerToday } from "../helpers/phase11";

afterEach(() => setClock(null));

/** The entry's debits and credits per DOMAIN §6 mapping key. */
async function linesOf(jeId: string, keys: string[]) {
  const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, jeId));
  const out: Record<string, { debit: bigint; credit: bigint }> = {};
  for (const k of keys) {
    const id = await accountIdFor(k);
    const ls = lines.filter((l) => l.accountId === id);
    out[k] = { debit: ls.reduce((s, l) => s + l.debit, 0n), credit: ls.reduce((s, l) => s + l.credit, 0n) };
  }
  const total = { debit: lines.reduce((s, l) => s + l.debit, 0n), credit: lines.reduce((s, l) => s + l.credit, 0n) };
  return { byKey: out, total };
}

describe("Phase 11 acceptance (A10.1 loan released 2026-01-15, first due 2026-02-15)", () => {
  beforeEach(async () => {
    on("2026-01-15");
    await setupServicing();
  });

  const release = () => releasedLoan({ firstDueDate: "2026-02-15" });

  it("A11.1 release ₱10,000.00 REG → GL Dr Loans Receivable 10,000 / Cr Cash 9,500 / Service Fee 200 / Subscription Receivable 200 / Notarial 100; paid-up +₱200; 12 rows = A10.1", async () => {
    const m = await member("Borrower");
    await goodStanding(m);
    const before = (await shareBalance(m)).paidUp;
    const l = await releasedLoan({ memberId: m, firstDueDate: "2026-02-15" });
    const { byKey, total } = await linesOf(l.releaseJeId, ["loans_receivable_REG", "cash_on_hand", "service_fee_income", "subscription_receivable_common", "notarial_fee_income"]);
    expect(byKey).toEqual({
      loans_receivable_REG: { debit: P(10000), credit: 0n },
      cash_on_hand: { debit: 0n, credit: P(9500) },
      service_fee_income: { debit: 0n, credit: P(200) },
      subscription_receivable_common: { debit: 0n, credit: P(200) },
      notarial_fee_income: { debit: 0n, credit: P(100) },
    });
    expect(total).toEqual({ debit: P(10000), credit: P(10000) });
    expect((await shareBalance(m)).paidUp - before).toBe(P(200));
    const loan = (await getLoan(l.loanId))!;
    const golden = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: "2026-02-15" });
    expect(loan.schedule.map((r) => [r.no, r.dueDate, r.principalDue, r.interestDue])).toEqual(golden.map((r) => [r.no, r.dueDate, r.principal, r.interest]));
    expect(loan.loan).toMatchObject({ status: "ACTIVE", releaseDate: "2026-01-15", firstDueDate: "2026-02-15", maturityDate: "2027-01-15" });
    expect(loan.loan.loanNo).toMatch(/^LN-2026-\d{5}$/);
  });

  it("A11.2 pay ₱916.80 on 2026-02-15 → interest 150.00 to Interest Income, principal 766.80 to Loans Receivable; outstanding ₱9,233.20; inst 1 PAID", async () => {
    const l = await release();
    on("2026-02-15");
    const r = await payLoan(l.memberId, l.loanId, "916.80");
    if (!r.ok) throw new Error(r.error);
    const [rc] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    const { byKey } = await linesOf(rc!.jeId, ["interest_income_loans", "loans_receivable_REG", "cash_on_hand"]);
    expect(byKey).toEqual({ interest_income_loans: { debit: 0n, credit: P(150) }, loans_receivable_REG: { debit: 0n, credit: P(766, 80) }, cash_on_hand: { debit: P(916, 80), credit: 0n } });
    const loan = (await getLoan(l.loanId))!;
    expect(loan.outstandingPrincipal).toBe(P(9233, 20));
    expect(loan.schedule[0]?.status).toBe("PAID");
  });

  it("A11.3 pay ₱500.00 on inst 1 → interest 150.00, principal 350.00; inst 1 PARTIAL", async () => {
    const l = await release();
    on("2026-02-15");
    expect((await payLoan(l.memberId, l.loanId, "500.00")).ok).toBe(true);
    const loan = (await getLoan(l.loanId))!;
    expect(loan.payments[0]).toMatchObject({ penaltyPart: 0n, interestPart: P(150), principalPart: P(350) });
    expect(loan.schedule[0]).toMatchObject({ interestPaid: P(150), principalPaid: P(350), status: "PARTIAL" });
  });

  it("A11.4 inst 1 unpaid on 2026-03-17 (30 days past due) → penalty ₱18.34; paying ₱935.14 → penalty 18.34, interest 150.00, principal 766.80; inst 1 PAID", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    expect((await getLoan(l.loanId))!.schedule[0]?.penaltyAccrued).toBe(P(18, 34));
    expect((await payLoan(l.memberId, l.loanId, "935.14")).ok).toBe(true);
    const loan = (await getLoan(l.loanId))!;
    expect(loan.payments[0]).toMatchObject({ penaltyPart: P(18, 34), interestPart: P(150), principalPart: P(766, 80) });
    expect(loan.schedule[0]?.status).toBe("PAID");
  });

  it("A11.5 pay ₱2,000.00 on 2026-02-15 → inst 1 and 2 PAID (916.80 each), inst 3 interest 126.82 + principal 39.58; outstanding ₱8,415.32", async () => {
    const l = await release();
    on("2026-02-15");
    expect((await payLoan(l.memberId, l.loanId, "2,000.00")).ok).toBe(true);
    const loan = (await getLoan(l.loanId))!;
    expect(loan.schedule.slice(0, 3).map((r) => [r.status, r.interestPaid, r.principalPaid])).toEqual([
      ["PAID", P(150), P(766, 80)],
      ["PAID", P(138, 50), P(778, 30)],
      ["PARTIAL", P(126, 82), P(39, 58)],
    ]);
    expect(loan.outstandingPrincipal).toBe(P(8415, 32));
  });

  it("A11.6 oldest unpaid due 2026-05-15, as of 2026-06-30 → 46 days past due; bucket \"31–90\"", async () => {
    const dpd = daysPastDue("2026-05-15", "2026-06-30");
    expect(dpd).toBe(46);
    expect(bucketFor(dpd, await getSetting("loan.aging_buckets"))).toBe("31–90");
  });

  it("A11.7 ₱10,000 current, ₱5,000 at 46 dpd, ₱5,000 at 10 dpd → PAR(>30) = 25.00%", () => {
    expect(
      parPercent(
        [
          { outstandingPrincipal: P(10000), daysPastDue: 0 },
          { outstandingPrincipal: P(5000), daysPastDue: 46 },
          { outstandingPrincipal: P(5000), daysPastDue: 10 },
        ],
        30,
      ),
    ).toBe("25.00");
  });

  it("A11.8 the daily job run twice for 2026-03-17 → penalties accrued once", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    const again = await runDailyJobs("2026-03-17");
    expect(again.find((o) => o.job === "loans-daily")?.status).toBe("skipped");
    const accruals = await getDb().select().from(loanPenaltyAccruals).where(eq(loanPenaltyAccruals.loanId, l.loanId));
    expect(accruals.map((a) => [a.scheduleNo, a.amount])).toEqual([[1, P(18, 34)]]);
  });

  it("A11.9 a borrower with a PAST_DUE loan can't apply for a new loan nor be named as a comaker", async () => {
    const l = await release();
    on("2026-03-17");
    await runDailyJobs("2026-03-17");
    expect((await getLoan(l.loanId))!.loan.status).toBe("PAST_DUE");
    const emr = (await loanProductByCode("EMR"))!;
    const own = await runAs(people().officer, () => submitApplicationAction({ memberId: l.memberId, productId: emr.id, amount: "5,000.00", term: 6, purpose: "Emergency", comakerIds: [] }));
    expect(own).toMatchObject({ ok: false, error: expect.stringMatching(/past-due loan/) });
    const other = await member("Other");
    await goodStanding(other);
    const prd = (await loanProductByCode("PRD"))!;
    const asComaker = await runAs(people().officer, () => submitApplicationAction({ memberId: other, productId: prd.id, amount: "5,000.00", term: 6, purpose: "Store", comakerIds: [l.memberId] }));
    expect(asComaker).toMatchObject({ ok: false, error: expect.stringMatching(/Comaker .*past-due loan/) });
  });

  it("A11.10 a fully paid loan → status PAID; the loan rule of canTerminate passes", async () => {
    const l = await release();
    on("2026-02-15");
    expect((await payLoan(l.memberId, l.loanId, "11,001.61")).ok).toBe(true);
    expect((await getLoan(l.loanId))!.loan.status).toBe("PAID");
    const t = await canTerminate(l.memberId, getDb());
    expect(t.reasons.filter((r) => /loan/i.test(r))).toEqual([]);
  });

  it("A11.11 write-off needs a BOD resolution; with one → Dr Allowance / Cr Loans Receivable for the outstanding principal", async () => {
    const l = await release();
    on("2026-02-15");
    expect((await payLoan(l.memberId, l.loanId, "916.80")).ok).toBe(true);
    expect(await runAs(people().manager, () => writeOffAction({ loanId: l.loanId, bodRef: "", reason: "Uncollectible" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Board resolution/) });
    const w = await runAs(people().manager, () => writeOffAction({ loanId: l.loanId, bodRef: "BOD 2026-40", reason: "Uncollectible" }));
    if (!w.ok) throw new Error(w.error);
    const { byKey } = await linesOf(w.data.jeId, ["allowance_probable_losses", "loans_receivable_REG"]);
    expect(byKey).toEqual({ allowance_probable_losses: { debit: P(9233, 20), credit: 0n }, loans_receivable_REG: { debit: 0n, credit: P(9233, 20) } });
    expect((await getLoan(l.loanId))!.loan.status).toBe("WRITTEN_OFF");
  });

  it("A11.12 reversing payment A11.2 → reversal entry; inst 1 back to OPEN; outstanding ₱10,000.00", async () => {
    const l = await release();
    on("2026-02-15");
    const r = await payLoan(l.memberId, l.loanId, "916.80");
    if (!r.ok) throw new Error(r.error);
    expect((await runAs(people().manager, () => cancelReceiptAction({ receiptId: r.data.id, reason: "Wrong loan" }))).ok).toBe(true);
    const [rc] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    expect(rc?.cancelJeId).toBeTruthy();
    const loan = (await getLoan(l.loanId))!;
    expect(loan.schedule[0]).toMatchObject({ status: "OPEN", interestPaid: 0n, principalPaid: 0n });
    expect(loan.outstandingPrincipal).toBe(P(10000));
    expect(loan.payments[0]?.reversedBy).toBe(rc?.cancelJeId);
  });
});

describe("Phase 11 acceptance: the cross-module receipt", () => {
  it("A11.14 ONE receipt: membership fee 500.00 + share payment 1,000.00 + savings deposit 2,000.00 + loan payment 916.80 + water bill 400.00 → ₱4,816.80, ONE CRJ; cancelling restores all five", async () => {
    on("2026-09-01");
    const base = await setupServicing({ water: true });
    // The member: good standing for the loan; the fee receipt is cancelled afterwards, so the fee is due again.
    const m = await member("Santos");
    const gs = await goodStanding(m);
    const loan = await releasedLoan({ memberId: m, firstDueDate: "2026-10-01" });
    expect((await runAs(people().manager, () => cancelReceiptAction({ receiptId: gs.feeReceiptId, reason: "Re-collect with the October payment" }))).ok).toBe(true);
    expect(await membershipFeePaid(m)).toBe(false);
    const savings = await runAs(await tellerToday(), async () => openAccountAction({ memberId: m, productId: (await (await import("@/modules/savings/service")).productByCode("SAV"))!.id }));
    if (!savings.ok) throw new Error(savings.error);
    const water = await activeAccount({ clerk: base.clerk.id, manager: base.manager.id, routeId: base.routeId, kind: "MEMBER", memberId: m });
    await billMonth(base.clerk.id, base.zoneId, "2026-09", [[water.accountId, 18]]);
    expect((await billBalances(getDb(), { accountIds: [water.accountId] })).reduce((s, b) => s + b.outstanding, 0n)).toBe(P(400));

    on("2026-10-01");
    const r = await receipt(m, [
      { type: "MEMBERSHIP_FEE", amount: "500.00" },
      { type: "SHARE_PAYMENT", amount: "1,000.00" },
      { type: "SAVINGS_DEPOSIT", amount: "2,000.00", refId: savings.data.id },
      { type: "LOAN_PAYMENT", amount: "916.80", refId: loan.loanId },
      { type: "WATER_BILL", amount: "400.00", refId: water.accountId },
    ]);
    if (!r.ok) throw new Error(r.error);
    const [rc] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    expect(rc?.total).toBe(P(4816, 80));
    const { byKey, total } = await linesOf(rc!.jeId, ["cash_on_hand", "membership_fee_income", "subscription_receivable_common", "savings_deposits", "interest_income_loans", "loans_receivable_REG", "ar_water"]);
    expect(byKey).toEqual({
      cash_on_hand: { debit: P(4816, 80), credit: 0n },
      membership_fee_income: { debit: 0n, credit: P(500) },
      subscription_receivable_common: { debit: 0n, credit: P(1000) },
      savings_deposits: { debit: 0n, credit: P(2000) },
      interest_income_loans: { debit: 0n, credit: P(150) },
      loans_receivable_REG: { debit: 0n, credit: P(766, 80) },
      ar_water: { debit: 0n, credit: P(400) },
    });
    expect(total).toEqual({ debit: P(4816, 80), credit: P(4816, 80) });
    // All five sub-ledgers moved.
    expect(await membershipFeePaid(m)).toBe(true);
    expect((await shareBalance(m)).paidUp).toBe(P(2500) + P(200) + P(1000));
    expect(await accountBalance(savings.data.id)).toBe(P(2000));
    expect((await getLoan(loan.loanId))!.schedule[0]?.status).toBe("PAID");
    expect((await billBalances(getDb(), { accountIds: [water.accountId] })).reduce((s, b) => s + b.outstanding, 0n)).toBe(0n);

    // Cancelling the receipt restores every one of them.
    expect((await runAs(people().manager, () => cancelReceiptAction({ receiptId: r.data.id, reason: "Wrong date" }))).ok).toBe(true);
    expect(await membershipFeePaid(m)).toBe(false);
    expect((await shareBalance(m)).paidUp).toBe(P(2500) + P(200));
    expect(await accountBalance(savings.data.id)).toBe(0n);
    expect((await getLoan(loan.loanId))!.schedule[0]).toMatchObject({ status: "OPEN", principalPaid: 0n, interestPaid: 0n });
    expect((await billBalances(getDb(), { accountIds: [water.accountId] })).reduce((s, b) => s + b.outstanding, 0n)).toBe(P(400));
  });
});
