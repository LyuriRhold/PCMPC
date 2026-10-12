import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { cancelReceiptAction } from "@/modules/cashiering/actions";
import { cashOuts } from "@/modules/cashiering/schema";
import { journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal } from "@/modules/ledger/service";
import { changeMemberStatusAction } from "@/modules/members/actions";
import { updateSetting } from "@/modules/settings/service";
import { approveWithdrawalAction, cancelWithdrawalAction, subscribeAction, transferAction, withdrawSharesAction } from "@/modules/share/actions";
import { shareWithdrawals } from "@/modules/share/schema";
import { averageShareMonth, cbuLines, membershipFeePaid, memberShareLedger, memberSubscriptions, retainCbu, shareBalance, withdraw } from "@/modules/share/service";
import { waterCustomers } from "@/modules/water/schema";
import { makeUser } from "../helpers/phase01";
import { P } from "../helpers/phase03";
import { openSessionAs } from "../helpers/phase04";
import { createCustomerAs, nonMember } from "../helpers/phase05";
import { at, member, pay, receipt, setupShares, subscribe, tellerToday } from "../helpers/phase08";

let manager = "";
beforeEach(async () => {
  const u = await setupShares();
  manager = u.manager.id;
});
afterEach(() => setClock(null));

/** Lets one member hold all the capital (the holding cap only applies above the minimum paid-up). */
async function liftCap() {
  await withTx((tx) => updateSetting(tx, "share.min_paid_up_regular", "100000000", manager));
}

describe("T8.2 subscriptions and payments", () => {
  it("the first subscription must reach the minimum (100 shares); later ones can be smaller", async () => {
    const m = await member();
    expect(await runAs(manager, () => subscribeAction({ memberId: m, shares: 50 }))).toEqual({ ok: false, error: "The subscription must total at least 100 shares (₱10,000.00)" });
    await subscribe(m, 100);
    expect((await runAs(manager, () => subscribeAction({ memberId: m, shares: 5 }))).ok).toBe(true);
    expect((await shareBalance(m)).subscribed).toBe(P(10500));
  });

  it("applicants can't subscribe", async () => {
    const { applicant, createApplicantAs } = await import("../helpers/phase02");
    const app = await createApplicantAs(manager, applicant({ lastName: "Applicant", firstName: "Ana", birthdate: "1991-02-02", tin: null, validIdNo: "ID-X" }));
    expect(await runAs(manager, () => subscribeAction({ memberId: app, shares: 100 }))).toMatchObject({ ok: false, error: expect.stringMatching(/only approved members/) });
  });

  it("with auto-subscribe on, a payment above the unpaid subscription subscribes whole shares for the excess", async () => {
    await withTx((tx) => updateSetting(tx, "share.auto_subscribe_excess", true, manager));
    await liftCap();
    const m = await member();
    await subscribe(m, 100);
    const r = await pay(m, "10,050.00");
    if (!r.ok) throw new Error(r.error);
    expect(await shareBalance(m)).toEqual({ subscribed: P(10100), paidUp: P(10050), unpaid: P(50) });
  });

  it("two share payments in one receipt are checked together against the unpaid subscription", async () => {
    const m = await member();
    await subscribe(m, 100);
    const r = await receipt(m, [
      { type: "SHARE_PAYMENT", amount: "1,500.00" },
      { type: "SHARE_PAYMENT", amount: "1,000.00" },
    ]);
    expect(r.ok).toBe(true);
    expect((await shareBalance(m)).paidUp).toBe(P(2500));
  });

  it("the membership fee is paid once; cancelling its receipt makes it unpaid again", async () => {
    const m = await member();
    const r = await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }]);
    if (!r.ok) throw new Error(r.error);
    expect(await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }])).toEqual({ ok: false, error: "This member's membership fee is already paid" });
    expect(await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "400.00" }])).toEqual({ ok: false, error: "The membership fee is ₱500.00" });
    expect((await runAs(manager, () => cancelReceiptAction({ receiptId: r.data.id, reason: "Wrong member" }))).ok).toBe(true);
    expect(await membershipFeePaid(m)).toBe(false);
  });

  it("a cancelled share payment no longer counts; it can't be cancelled once the capital was transferred away", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    await subscribe(b, 100);
    const p1 = await pay(a, "1,000.00");
    if (!p1.ok) throw new Error(p1.error);
    expect((await runAs(manager, () => cancelReceiptAction({ receiptId: p1.data.id, reason: "Wrong amount" }))).ok).toBe(true);
    expect((await shareBalance(a)).paidUp).toBe(0n);
    expect((await memberShareLedger(a)).rows.map((r) => r.type)).toEqual(["SUBSCRIBE"]);

    const p2 = await pay(a, "2,000.00");
    if (!p2.ok) throw new Error(p2.error);
    expect((await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1,500.00", bodRef: "BOD 1" }))).ok).toBe(true);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: p2.data.id, reason: "Oops" }))).toEqual({ ok: false, error: expect.stringMatching(/can't be cancelled/) });
  });

  it("ASM ignores cancelled receipts and counts mid-year payments from their month-end", async () => {
    setClock(() => at("2026-03-10"));
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "1,200.00")).ok).toBe(true);
    // Mar–Dec = 10 month-ends × 1,200 = 12,000 ÷ 12 = 1,000.
    expect(await averageShareMonth(m, 2026)).toBe(P(1000));
  });
});

describe("T8.2 transfers", () => {
  it("can't transfer more than the paid-up, nor to an INACTIVE member", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    expect((await pay(a, "1,000.00")).ok).toBe(true);
    expect(await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1,000.01", bodRef: "BOD 1" }))).toMatchObject({ ok: false, error: expect.stringMatching(/has only ₱1,000.00 paid-up/) });
    expect((await runAs(manager, () => changeMemberStatusAction({ memberId: b, to: "INACTIVE", reason: "Moved", ref: null }))).ok).toBe(true);
    expect(await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "500.00", bodRef: "BOD 1" }))).toMatchObject({ ok: false, error: expect.stringMatching(/INACTIVE/) });
  });
});

describe("T8.2 withdrawal and termination", () => {
  it("a member with share capital can't be terminated; after the manager approves and a teller pays it out (unpaid subscription cancelled) they can", async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "2,500.00")).ok).toBe(true);
    const blocked = await runAs(manager, () => changeMemberStatusAction({ memberId: m, to: "TERMINATED", reason: "Resigned", ref: "Letter" }));
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/share capital must be fully withdrawn\/settled first \(paid-up ₱2,500.00, unpaid subscription ₱7,500.00\)/) });

    const teller = await tellerToday();
    // The drawer must hold the cash: a receipt for something else puts ₱2,500.00 in it.
    const other = await member("Other");
    await subscribe(other, 100);
    expect((await pay(other, "2,500.00")).ok).toBe(true);
    // Not without the manager's approval on the Board's termination resolution.
    expect(await runAs(teller, () => withdrawSharesAction({ memberId: m }))).toMatchObject({ ok: false, error: expect.stringMatching(/must first be approved by the manager/) });
    expect((await runAs(manager, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "2026-30" }))).ok).toBe(true);
    const w = await runAs(teller, () => withdrawSharesAction({ memberId: m }));
    if (!w.ok) throw new Error(w.error);
    expect(w.data.cash).toBe(String(P(2500)));
    expect(await shareBalance(m)).toEqual({ subscribed: 0n, paidUp: 0n, unpaid: 0n });
    const outs = await getDb().select().from(cashOuts).where(eq(cashOuts.type, "SHARE_WITHDRAWAL"));
    expect(outs.map((o) => o.amount)).toEqual([P(2500)]);
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, w.data.jeId));
    expect(lines.reduce((s, l) => s + l.debit, 0n)).toBe(P(10000));
    expect((await memberShareLedger(m)).rows.map((r) => r.type)).toEqual(["SUBSCRIBE", "PAYMENT", "ADJUSTMENT", "WITHDRAWAL"]);
    expect((await memberSubscriptions(m)).map((s) => s.status)).toEqual(["CANCELLED"]);
    const [approval] = await getDb().select().from(shareWithdrawals).where(eq(shareWithdrawals.memberId, m));
    expect(approval).toMatchObject({ status: "PAID", paidBy: teller, jeId: w.data.jeId });
    const clerk = await makeUser("BILLING_CLERK", "clerk8");
    const water = await createCustomerAs(clerk.id, nonMember({ type: "MEMBER", memberId: m }));
    expect((await runAs(manager, () => changeMemberStatusAction({ memberId: m, to: "TERMINATED", reason: "Resigned", ref: "Letter" }))).ok).toBe(true);
    // A terminated member's water customer continues as NON_MEMBER (Phase 05 rule).
    const [customer] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, water.id));
    expect(customer?.type).toBe("NON_MEMBER");
  });

  it("only the manager approves and only a teller pays out, never the same person; an approval can be cancelled", async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "2,500.00")).ok).toBe(true);
    const teller = await tellerToday();
    await expect(runAs(teller, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "2026-30" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(manager, () => withdrawSharesAction({ memberId: m }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(manager, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Board resolution/) });
    expect((await runAs(manager, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "2026-30" }))).ok).toBe(true);
    expect(await runAs(manager, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "2026-30" }))).toMatchObject({ ok: false, error: expect.stringMatching(/already approved/) });
    // No role holds both permissions; the service still refuses the approver as the payer.
    await expect(withTx((tx) => withdraw(tx, { memberId: m }, manager))).rejects.toThrow(/Segregation of duties/);
    expect((await runAs(manager, () => cancelWithdrawalAction({ memberId: m, reason: "The member stays" }))).ok).toBe(true);
    expect(await runAs(teller, () => withdrawSharesAction({ memberId: m }))).toMatchObject({ ok: false, error: expect.stringMatching(/must first be approved/) });
    expect((await shareBalance(m)).paidUp).toBe(P(2500));
  });

  it("the drawer must hold the payout", async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "2,500.00")).ok).toBe(true);
    const t = await makeUser("TELLER", "emptydrawer");
    await openSessionAs(t.id, "0");
    expect((await runAs(manager, () => approveWithdrawalAction({ memberId: m, reason: "Resignation", bodRef: "2026-30" }))).ok).toBe(true);
    expect(await runAs(t.id, () => withdrawSharesAction({ memberId: m }))).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough cash in the drawer/) });
  });
});

describe("T8.2 CBU retention (for Phase 11)", () => {
  it("credits paid-up; above the unpaid subscription it subscribes whole shares first", async () => {
    await liftCap();
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "9,950.00")).ok).toBe(true);
    const lines = await withTx((tx) => cbuLines(tx, m, P(120)));
    const cash = await accountIdFor("cash_on_hand");
    const je = await withTx((tx) => postJournal(tx, { date: "2026-10-07", book: "GJ", particulars: "Loan release (test)", lines: [{ accountId: cash, debit: P(120) }, ...lines] }, manager));
    await withTx((tx) => retainCbu(tx, m, P(120), { jeId: je.id, ref: "LN-TEST" }, manager));
    // Unpaid was ₱50: one more share (₱100) is subscribed, then ₱120 is credited.
    expect(await shareBalance(m)).toEqual({ subscribed: P(10100), paidUp: P(10070), unpaid: P(30) });
  });
});

describe("review follow-ups", () => {
  it("auto-subscribe counts shares already subscribed by an earlier item of the same receipt", async () => {
    await withTx((tx) => updateSetting(tx, "share.auto_subscribe_excess", true, manager));
    await liftCap();
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "9,000.00")).ok).toBe(true);
    // Unpaid ₱1,000.00: ₱1,500.00 subscribes 5 more shares, then ₱100.00 needs exactly 1 more.
    const r = await receipt(m, [
      { type: "SHARE_PAYMENT", amount: "1,500.00" },
      { type: "SHARE_PAYMENT", amount: "100.00" },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(await shareBalance(m)).toEqual({ subscribed: P(10600), paidUp: P(10600), unpaid: 0n });
  });

  it("a payment can't be cancelled once capital was transferred out after it, even if the paid-up still covers it", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    await subscribe(b, 100);
    const r1 = await pay(a, "2,000.00");
    if (!r1.ok) throw new Error(r1.error);
    expect((await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "500.00", bodRef: "BOD 2" }))).ok).toBe(true);
    expect((await pay(a, "500.00")).ok).toBe(true);
    expect((await shareBalance(a)).paidUp).toBe(P(2000));
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: r1.data.id, reason: "Oops" }))).toMatchObject({ ok: false, error: expect.stringMatching(/transferred or withdrawn afterwards/) });
  });

  it("no membership fee from a terminated member", async () => {
    const m = await member();
    expect((await runAs(manager, () => changeMemberStatusAction({ memberId: m, to: "TERMINATED", reason: "Resigned", ref: "Letter" }))).ok).toBe(true);
    expect(await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }])).toMatchObject({ ok: false, error: expect.stringMatching(/TERMINATED; no membership fee/) });
  });

  it("subscriptions need members.write; transfers need members.approve", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    const teller = await tellerToday();
    const officer = (await makeUser("LOAN_OFFICER", "officer8")).id;
    await expect(runAs(teller, () => subscribeAction({ memberId: a, shares: 100 }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(teller, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1.00", bodRef: "X" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAs(officer, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1.00", bodRef: "X" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await runAs(officer, () => subscribeAction({ memberId: a, shares: 100 }))).ok).toBe(true);
  });

  it("share rows and fees can't be changed or deleted; a subscription can only change status", async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }])).ok).toBe(true);
    const pool = getPool();
    await expect(pool.query("UPDATE share_transactions SET amount = 1 WHERE member_id = $1", [m])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM share_transactions WHERE member_id = $1", [m])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE member_fees SET amount = 1 WHERE member_id = $1", [m])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM member_fees WHERE member_id = $1", [m])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE share_subscriptions SET shares = 1, amount = par_value WHERE member_id = $1", [m])).rejects.toThrow(/only the status can change/);
    await expect(pool.query("DELETE FROM share_subscriptions WHERE member_id = $1", [m])).rejects.toThrow(/can't be deleted/);
    await pool.query("UPDATE share_subscriptions SET status = 'CANCELLED' WHERE member_id = $1", [m]);
  });

  it("CBU retention is recorded only against an entry that credits the member's share capital with that amount", async () => {
    const m = await member();
    await subscribe(m, 100);
    const [cash, fee] = await Promise.all([accountIdFor("cash_on_hand"), accountIdFor("membership_fee_income")]);
    const je = await withTx((tx) => postJournal(tx, { date: "2026-10-07", book: "GJ", particulars: "Not a CBU entry", lines: [{ accountId: cash, debit: P(120) }, { accountId: fee, credit: P(120) }] }, manager));
    await expect(withTx((tx) => retainCbu(tx, m, P(120), { jeId: je.id, ref: "LN-X" }, manager))).rejects.toThrow(/doesn't credit this member's share capital/);
    expect((await shareBalance(m)).paidUp).toBe(0n);
  });
});
