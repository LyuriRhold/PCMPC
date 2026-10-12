import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { cancelReceiptAction } from "@/modules/cashiering/actions";
import { receipts } from "@/modules/cashiering/schema";
import { duesFor } from "@/modules/cashiering/registry";
import { journalLines } from "@/modules/ledger/schema";
import { subsidiaryLedger, trialBalance } from "@/modules/ledger/service";
import { changeMemberStatusAction } from "@/modules/members/actions";
import {
  closeAccountAction,
  matureTimeDepositAction,
  openAccountAction,
  placeTimeDepositAction,
  preterminateTimeDepositAction,
  reactivateAction,
  rolloverTimeDepositAction,
  runInterestAction,
  updateProductAction,
  withdrawAction,
} from "@/modules/savings/actions";
import { depositTransactions, timeDeposits } from "@/modules/savings/schema";
import { accountBalance, depositLedger, getAccount, markDormant, previewInterest, productByCode } from "@/modules/savings/service";
import { makeUser } from "../helpers/phase01";
import { P } from "../helpers/phase03";
import { activeMember, bookkeeperId, deposit, on, openSavings, productId, setupSavings, tellerToday, withdraw } from "../helpers/phase09";

let manager = "";
beforeEach(async () => {
  on("2026-01-01");
  manager = (await setupSavings()).manager.id;
});
afterEach(() => setClock(null));

const runQ1 = async () => {
  on("2026-04-01");
  return runAs(bookkeeperId(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd: "2026-03-31" }));
};

/** Sets the regular savings product's withholding tax (admin). */
async function setWtax(pct: string) {
  const admin = (await makeUser("ADMIN", "admin9")).id;
  const p = await productByCode("SAV");
  if (!p) throw new Error("no SAV");
  const r = await runAs(admin, () =>
    updateProductAction({ productId: p.id, name: p.name, ratePct: "2", minBalanceEarn: "500.00", maintainingBalance: "100.00", dormantAfterMonths: 24, wtaxPct: pct, active: true }),
  );
  if (!r.ok) throw new Error(r.error);
}

describe("T9.2 accounts, deposits and withdrawals", () => {
  it("one regular savings account per member; another member's account can't take the payor's deposit", async () => {
    const a = await activeMember("Alpha");
    const b = await activeMember("Bravo");
    const acc = await openSavings(a);
    expect(await runAs(await tellerToday(), async () => openAccountAction({ memberId: a, productId: await productId("SAV") }))).toMatchObject({ ok: false, error: expect.stringMatching(/already has a Regular Savings account \(SA-\d{6}\)/) });
    expect(await runAs(await tellerToday(), async () => openAccountAction({ memberId: a, productId: await productId("TD") }))).toMatchObject({ ok: false, error: expect.stringMatching(/placing one from the member's savings account/) });
    expect(await deposit(b, acc, "100.00")).toMatchObject({ ok: false, error: "Deposit to the payor's own savings account" });
  });

  it("the teller sees the member's savings accounts as deposits with an open amount", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    const dues = await duesFor(getDb(), { type: "MEMBER", id: m, name: "" });
    expect(dues.filter((d) => d.type === "SAVINGS_DEPOSIT")).toEqual([expect.objectContaining({ refId: acc, amount: 0n, openAmount: true, description: expect.stringMatching(/^Savings deposit · SA-\d{6}$/) })]);
  });

  it("a cancelled deposit receipt comes back out of the passbook on the reversal entry; not once the money was withdrawn", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    const r1 = await deposit(m, acc, "1,000.00");
    if (!r1.ok) throw new Error(r1.error);
    expect((await runAs(manager, () => cancelReceiptAction({ receiptId: r1.data.id, reason: "Wrong account" }))).ok).toBe(true);
    const rows = (await depositLedger(acc)).rows;
    expect(rows.map((r) => [r.type, r.amount, r.balanceAfter])).toEqual([
      ["DEPOSIT", P(1000), P(1000)],
      ["ADJUSTMENT", -P(1000), 0n],
    ]);
    const [adj] = await getDb().select().from(depositTransactions).where(eq(depositTransactions.type, "ADJUSTMENT"));
    const [cancelled] = await getDb().select().from(receipts).where(eq(receipts.id, r1.data.id));
    expect(adj?.jeId).toBe(cancelled?.cancelJeId);

    const r2 = await deposit(m, acc, "2,000.00");
    if (!r2.ok) throw new Error(r2.error);
    expect((await withdraw(acc, "1,500.00")).ok).toBe(true);
    // Another member's deposit keeps enough cash in the drawer, so the savings rule is what refuses.
    const other = await activeMember("Other");
    expect((await deposit(other, await openSavings(other), "5,000.00")).ok).toBe(true);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: r2.data.id, reason: "Oops" }))).toMatchObject({ ok: false, error: expect.stringMatching(/already withdrawn/) });
  });

  it("a dormant account takes no withdrawal until the manager reactivates it; reactivation restarts the dormancy period", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "1,000.00")).ok).toBe(true);
    await withTx((tx) => markDormant(tx, "2028-01-01"));
    expect((await getAccount(acc))?.status).toBe("DORMANT");
    expect(await withdraw(acc, "100.00")).toMatchObject({ ok: false, error: expect.stringMatching(/dormant; it must be reactivated first/) });
    await expect(runAs(await tellerToday(), () => reactivateAction({ accountId: acc, reason: "Member came in" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(manager, () => reactivateAction({ accountId: acc, reason: "" }))).toMatchObject({ ok: false });
    expect((await runAs(manager, () => reactivateAction({ accountId: acc, reason: "Member came in with an ID" }))).ok).toBe(true);
    expect((await getAccount(acc))?.status).toBe("OPEN");
    expect((await getAccount(acc))?.lastCustomerTxnAt).toBe("2026-01-01");
    expect((await withdraw(acc, "100.00")).ok).toBe(true);
  });

  it("closing pays out the whole balance (below the maintaining balance); the member can be terminated only after", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "750.00")).ok).toBe(true);
    const blocked = await runAs(manager, () => changeMemberStatusAction({ memberId: m, to: "TERMINATED", reason: "Resigned", ref: "Letter" }));
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/all deposit accounts must be closed \(zero balance\) first \(SA-\d{6}\)/) });
    const r = await runAs(await tellerToday(), () => closeAccountAction({ accountId: acc }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.paidOut).toBe(String(P(750)));
    expect(await accountBalance(acc)).toBe(0n);
    expect((await getAccount(acc))?.status).toBe("CLOSED");
    expect(await deposit(m, acc, "100.00")).toMatchObject({ ok: false, error: expect.stringMatching(/is closed/) });
    expect((await runAs(manager, () => changeMemberStatusAction({ memberId: m, to: "TERMINATED", reason: "Resigned", ref: "Letter" }))).ok).toBe(true);
  });

  it("withdrawals need a teller session; product changes need the admin", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    await expect(runAs(bookkeeperId(), () => withdrawAction({ accountId: acc, amount: "1.00" }))).rejects.toBeInstanceOf(ForbiddenError);
    const p = await productByCode("SAV");
    await expect(
      runAs(manager, () => updateProductAction({ productId: p!.id, name: "X", ratePct: "3", minBalanceEarn: "0", maintainingBalance: "0", dormantAfterMonths: 24, wtaxPct: "0", active: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the passbook for a date range starts from the balance before it", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "1,000.00")).ok).toBe(true);
    on("2026-02-10");
    expect((await deposit(m, acc, "500.00")).ok).toBe(true);
    const l = await depositLedger(acc, { from: "2026-02-01" });
    expect(l.opening).toBe(P(1000));
    expect(l.rows.map((r) => r.balanceAfter)).toEqual([P(1500)]);
    expect(l.closing).toBe(P(1500));
  });
});

describe("T9.3 interest runs", () => {
  it("only after the quarter ends, only on quarter ends, and only with savings.run_interest", async () => {
    on("2026-03-31");
    expect(await runAs(bookkeeperId(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd: "2026-03-31" }))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't over yet/) });
    on("2026-04-01");
    expect(await runAs(bookkeeperId(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd: "2026-03-30" }))).toMatchObject({ ok: false, error: expect.stringMatching(/quarter end/) });
    await expect(runAs(await tellerToday(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd: "2026-03-31" }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("withholding tax is deducted per account and credited to Withholding Tax Payable; one balanced entry, member-tagged", async () => {
    await setWtax("20");
    const a = await activeMember("Alpha");
    const b = await activeMember("Bravo");
    const accA = await openSavings(a);
    const accB = await openSavings(b);
    expect((await deposit(a, accA, "10,000.00")).ok).toBe(true);
    expect((await deposit(b, accB, "15,000.00")).ok).toBe(true);
    const r = await runQ1();
    if (!r.ok) throw new Error(r.error);
    // A: 49.32 interest, 9.86 tax; B: 73.97 interest, 14.79 tax.
    expect(r.data).toMatchObject({ accounts: 2, total: String(P(123, 29)), wtax: String(P(24, 65)) });
    expect((await depositLedger(accA)).rows.slice(-2).map((x) => [x.type, x.amount])).toEqual([
      ["INTEREST", P(49, 32)],
      ["WTAX", -P(9, 86)],
    ]);
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, r.data.jeId!));
    expect(lines.reduce((s, l) => s + l.debit, 0n)).toBe(lines.reduce((s, l) => s + l.credit, 0n));
    const sub = await subsidiaryLedger("savings_deposits", a, "2026-01-01", "2026-12-31");
    expect(sub.closing).toBe(await accountBalance(accA));
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("dormant accounts earn; closed accounts don't", async () => {
    const a = await activeMember("Alpha");
    const b = await activeMember("Bravo");
    const accA = await openSavings(a);
    const accB = await openSavings(b);
    expect((await deposit(a, accA, "10,000.00")).ok).toBe(true);
    expect((await deposit(b, accB, "10,000.00")).ok).toBe(true);
    on("2026-03-15");
    // A third member's deposit puts cash in the new day's drawer for B's payout.
    const c = await activeMember("Charlie");
    expect((await deposit(c, await openSavings(c), "10,000.00")).ok).toBe(true);
    expect((await runAs(await tellerToday(), () => closeAccountAction({ accountId: accB }))).ok).toBe(true);
    await withTx((tx) => markDormant(tx, "2028-03-31"));
    expect((await getAccount(accA))?.status).toBe("DORMANT");
    on("2026-04-01");
    const lines = await previewInterest(await productId("SAV"), "2026-03-31");
    expect(lines.find((l) => l.accountId === accB)).toBeUndefined();
    expect(lines.find((l) => l.accountId === accA)?.interest).toBe(P(49, 32));
  });
});

describe("T9.4 time deposits", () => {
  async function placed(principal = "50,000.00", termDays = 180) {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "50,100.00")).ok).toBe(true);
    const r = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: acc, principal, termDays }));
    if (!r.ok) throw new Error(r.error);
    return { m, acc, td: r.data.timeDepositId, tdAccount: r.data.accountId, certificateNo: r.data.certificateNo };
  }

  it("placement moves the money from savings (keeping the maintaining balance) into Time Deposits, member-tagged", async () => {
    const { m, acc, tdAccount, certificateNo } = await placed();
    expect(certificateNo).toMatch(/^TD-\d{6}-1$/);
    expect(await accountBalance(acc)).toBe(P(100));
    expect(await accountBalance(tdAccount)).toBe(P(50000));
    expect((await subsidiaryLedger("time_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(P(50000));
    expect((await subsidiaryLedger("savings_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(P(100));
    const r = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: acc, principal: "1.00", termDays: 30 }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/at most ₱0\.00 can go into a time deposit/) });
  });

  it("maturity only from the maturity date; pre-termination only before it", async () => {
    const { td } = await placed();
    on("2026-06-29");
    expect(await runAs(await tellerToday(), () => matureTimeDepositAction({ timeDepositId: td }))).toMatchObject({ ok: false, error: expect.stringMatching(/matures on Jun 30, 2026/) });
    on("2026-06-30");
    expect(await runAs(await tellerToday(), () => preterminateTimeDepositAction({ timeDepositId: td }))).toMatchObject({ ok: false, error: expect.stringMatching(/has matured/) });
    expect((await runAs(await tellerToday(), () => matureTimeDepositAction({ timeDepositId: td }))).ok).toBe(true);
    expect(await runAs(await tellerToday(), () => matureTimeDepositAction({ timeDepositId: td }))).toMatchObject({ ok: false, error: expect.stringMatching(/already matured/) });
  });

  it("rolled over with its interest: a new certificate for principal + interest; the TD account stays open", async () => {
    const { m, acc, td, tdAccount } = await placed();
    on("2026-06-30");
    const r = await runAs(await tellerToday(), () => rolloverTimeDepositAction({ timeDepositId: td, withInterest: true, termDays: 90 }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ certificateNo: expect.stringMatching(/^TD-\d{6}-2$/), interest: String(P(739, 73)), principal: String(P(50739, 73)) });
    expect(await accountBalance(tdAccount)).toBe(P(50739, 73));
    expect(await accountBalance(acc)).toBe(P(100));
    expect((await getAccount(tdAccount))?.status).toBe("OPEN");
    expect((await subsidiaryLedger("time_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(P(50739, 73));
    const [old] = await getDb().select().from(timeDeposits).where(eq(timeDeposits.id, td));
    expect(old?.status).toBe("ROLLED_OVER");
  });

  it("rolled over without its interest: the interest goes to savings, the principal stays", async () => {
    const { acc, td, tdAccount } = await placed();
    on("2026-06-30");
    const r = await runAs(await tellerToday(), () => rolloverTimeDepositAction({ timeDepositId: td, withInterest: false, termDays: 180 }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.principal).toBe(String(P(50000)));
    expect(await accountBalance(tdAccount)).toBe(P(50000));
    expect(await accountBalance(acc)).toBe(P(100) + P(739, 73));
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("a savings account paying back a time deposit can't be closed", async () => {
    const { acc } = await placed();
    expect(await runAs(await tellerToday(), () => closeAccountAction({ accountId: acc }))).toMatchObject({ ok: false, error: expect.stringMatching(/pays back into SA-\d{6}; end it first/) });
  });
});

describe("database rules", () => {
  it("passbook rows can't be changed or deleted; a time deposit only changes its closing fields, once", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "60,000.00")).ok).toBe(true);
    const r = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: acc, principal: "50,000.00", termDays: 180 }));
    if (!r.ok) throw new Error(r.error);
    const pool = getPool();
    await expect(pool.query("UPDATE deposit_transactions SET amount = 1 WHERE account_id = $1", [acc])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM deposit_transactions WHERE account_id = $1", [acc])).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE time_deposits SET principal = 1 WHERE id = $1", [r.data.timeDepositId])).rejects.toThrow(/only the closing fields can change/);
    await expect(pool.query("DELETE FROM time_deposits WHERE id = $1", [r.data.timeDepositId])).rejects.toThrow(/can't be deleted/);
    on("2026-04-01");
    expect((await runAs(await tellerToday(), () => preterminateTimeDepositAction({ timeDepositId: r.data.timeDepositId }))).ok).toBe(true);
    await expect(pool.query("UPDATE time_deposits SET status = 'ACTIVE', closed_at = NULL WHERE id = $1", [r.data.timeDepositId])).rejects.toThrow(/PRETERMINATED time deposit can't be changed/);
  });
});

describe("review follow-ups", () => {
  const runFor = async (periodEnd: string) => runAs(bookkeeperId(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd }));

  it("a deposit made after the quarter end but before the run doesn't count twice in the next quarter", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "10,000.00")).ok).toBe(true);
    on("2026-04-01");
    expect((await deposit(m, acc, "5,000.00")).ok).toBe(true);
    const q1 = await runFor("2026-03-31");
    if (!q1.ok) throw new Error(q1.error);
    // The passbook is in date order: the Mar 31 interest comes before the Apr 1 deposit.
    expect((await depositLedger(acc)).rows.map((r) => [r.date, r.type, r.balanceAfter])).toEqual([
      ["2026-01-01", "DEPOSIT", P(10000)],
      ["2026-03-31", "INTEREST", P(10049, 32)],
      ["2026-04-01", "DEPOSIT", P(15049, 32)],
    ]);
    expect((await depositLedger(acc, { from: "2026-04-01" })).opening).toBe(P(10049, 32));
    on("2026-07-01");
    const [q2] = await previewInterest(await productId("SAV"), "2026-06-30");
    expect(q2?.adb).toBe(P(15049, 32));
  });

  it("previewing a quarter after its run shows the interest that was posted", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "1,000,000.00")).ok).toBe(true);
    const r = await runQ1();
    if (!r.ok) throw new Error(r.error);
    const [again] = await previewInterest(await productId("SAV"), "2026-03-31");
    expect(again?.interest).toBe(BigInt(r.data.total));
    expect(again?.interest).toBe(P(4931, 51));
  });

  it("quarters run in order; an account closes only after the last quarter's interest is credited", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "10,000.00")).ok).toBe(true);
    on("2026-07-01");
    expect(await runFor("2026-06-30")).toMatchObject({ ok: false, error: expect.stringMatching(/quarter ending Mar 31, 2026 first/) });
    expect(await runAs(await tellerToday(), () => closeAccountAction({ accountId: acc }))).toMatchObject({ ok: false, error: expect.stringMatching(/quarter ending Jun 30, 2026 first/) });
    expect((await runFor("2026-03-31")).ok).toBe(true);
    expect((await runFor("2026-06-30")).ok).toBe(true);
    // Another member's deposit puts the payout cash in today's drawer.
    const other = await activeMember("Other");
    expect((await deposit(other, await openSavings(other), "20,000.00")).ok).toBe(true);
    const before = await accountBalance(acc);
    expect(before).toBeGreaterThan(P(10000)); // Q1 and Q2 interest credited
    const closed = await runAs(await tellerToday(), () => closeAccountAction({ accountId: acc }));
    if (!closed.ok) throw new Error(closed.error);
    expect(BigInt(closed.data.paidOut)).toBe(before);
  });

  it("an account opened mid-quarter averages over the whole quarter (CONFIRM Q-09.8)", async () => {
    on("2026-03-20");
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "1,000.00")).ok).toBe(true);
    on("2026-04-01");
    const [row] = await previewInterest(await productId("SAV"), "2026-03-31");
    expect(row).toMatchObject({ accountId: acc, adb: P(133, 33), interest: 0n }); // 1,000 × 12 days ÷ 90
  });

  it("dormancy counts from the opening when there was no deposit; closed and dormant accounts are left alone", async () => {
    const a = await activeMember("Alpha");
    const b = await activeMember("Bravo");
    const accA = await openSavings(a);
    const accB = await openSavings(b);
    expect((await runAs(await tellerToday(), () => closeAccountAction({ accountId: accB }))).ok).toBe(true);
    expect(await withTx((tx) => markDormant(tx, "2027-12-31"))).toEqual({ dormant: 0 });
    expect(await withTx((tx) => markDormant(tx, "2028-01-01"))).toEqual({ dormant: 1 });
    expect(await withTx((tx) => markDormant(tx, "2028-01-02"))).toEqual({ dormant: 0 });
    expect((await getAccount(accA))?.status).toBe("DORMANT");
    expect((await getAccount(accB))?.status).toBe("CLOSED");
  });

  it("time-deposit interest with withholding tax: net to savings, tax to Withholding Tax Payable; balanced", async () => {
    const admin = (await makeUser("ADMIN", "admin9td")).id;
    const td = await productByCode("TD");
    expect((await runAs(admin, () => updateProductAction({ productId: td!.id, name: td!.name, ratePct: "3", minBalanceEarn: "0", maintainingBalance: "0", dormantAfterMonths: null, wtaxPct: "20", active: true }))).ok).toBe(true);
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "50,100.00")).ok).toBe(true);
    const placed = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: td!.id, fromAccountId: acc, principal: "50,000.00", termDays: 180 }));
    if (!placed.ok) throw new Error(placed.error);
    on("2026-06-30");
    const r = await runAs(await tellerToday(), () => matureTimeDepositAction({ timeDepositId: placed.data.timeDepositId }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.interest).toBe(String(P(739, 73)));
    // Tax 739.73 × 20% = 147.946 → 147.95; net 591.78.
    expect(await accountBalance(acc)).toBe(P(100) + P(50000) + P(591, 78));
    expect(await accountBalance(placed.data.accountId)).toBe(0n);
    expect((await subsidiaryLedger("time_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(0n);
    expect((await subsidiaryLedger("savings_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(P(50691, 78));
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });

  it("pre-termination: the time deposit leaves the GL and its principal and interest reach savings", async () => {
    const m = await activeMember();
    const acc = await openSavings(m);
    expect((await deposit(m, acc, "50,100.00")).ok).toBe(true);
    const placed = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: acc, principal: "50,000.00", termDays: 180 }));
    if (!placed.ok) throw new Error(placed.error);
    on("2026-04-01");
    expect((await runAs(await tellerToday(), () => preterminateTimeDepositAction({ timeDepositId: placed.data.timeDepositId }))).ok).toBe(true);
    expect((await subsidiaryLedger("time_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(0n);
    expect((await subsidiaryLedger("savings_deposits", m, "2026-01-01", "2026-12-31")).closing).toBe(P(50346, 58));
    expect((await getAccount(placed.data.accountId))?.status).toBe("CLOSED");
    expect((await trialBalance("2026-12-31")).balanced).toBe(true);
  });
});
