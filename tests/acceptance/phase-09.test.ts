import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { runDailyJobs } from "@/lib/cron";
import { setClock } from "@/lib/dates";
import { journalEntries } from "@/modules/ledger/schema";
import { subsidiaryLedger } from "@/modules/ledger/service";
import { matureTimeDepositAction, openAccountAction, placeTimeDepositAction, preterminateTimeDepositAction, runInterestAction } from "@/modules/savings/actions";
import { accountBalance, depositLedger, getAccount, previewInterest } from "@/modules/savings/service";
import { P } from "../helpers/phase03";
import { activeMember, applicantOnly, bookkeeperId, deposit, fiscalYear, on, openSavings, productId, setupSavings, tellerToday, withdraw } from "../helpers/phase09";

// Golden (PHASE-09): regular savings 2% p.a., actual/365, min ₱500.00 ADB to earn, maintaining ₱100.00.
beforeEach(async () => {
  on("2026-01-01");
  await setupSavings();
});
afterEach(() => setClock(null));

/** The interest credited to an account by a run (0 when none). */
async function interestCredited(accountId: string): Promise<bigint> {
  return (await depositLedger(accountId)).rows.filter((r) => r.type === "INTEREST").reduce((s, r) => s + r.amount, 0n);
}

async function runQ1() {
  on("2026-04-01");
  return runAs(bookkeeperId(), async () => runInterestAction({ productId: await productId("SAV"), periodEnd: "2026-03-31" }));
}

describe("Phase 09 acceptance", () => {
  it("A9.1 APPLICANT opens savings → rejected \"Member must be ACTIVE\"", async () => {
    const m = await applicantOnly();
    const r = await runAs(await tellerToday(), async () => openAccountAction({ memberId: m, productId: await productId("SAV") }));
    expect(r).toEqual({ ok: false, error: "Member must be ACTIVE" });
  });

  it("A9.2 deposit ₱10,000.00, withdraw ₱3,000.00 → balance ₱7,000.00; GL Savings Deposits subsidiary for the member = ₱7,000.00 Cr", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "10,000.00")).ok).toBe(true);
    const w = await withdraw(a, "3,000.00");
    if (!w.ok) throw new Error(w.error);
    expect(await accountBalance(a)).toBe(P(7000));
    const sub = await subsidiaryLedger("savings_deposits", m, "2026-01-01", "2026-12-31");
    expect(sub.side).toBe("CR");
    expect(sub.closing).toBe(P(7000));
  });

  it("A9.3 withdraw ₱6,950.00 from ₱7,000.00 → rejected (would breach the maintaining balance ₱100.00)", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "7,000.00")).ok).toBe(true);
    expect(await withdraw(a, "6,950.00")).toMatchObject({ ok: false, error: expect.stringMatching(/maintaining balance ₱100\.00/) });
    expect(await accountBalance(a)).toBe(P(7000));
  });

  it("A9.4 constant ₱10,000.00 for a 90-day quarter → interest ₱49.32", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "10,000.00")).ok).toBe(true);
    const r = await runQ1();
    if (!r.ok) throw new Error(r.error);
    expect(await interestCredited(a)).toBe(P(49, 32));
    expect(await accountBalance(a)).toBe(P(10049, 32));
  });

  it("A9.5 ₱10,000.00 for 45 days then ₱20,000.00 for 45 days → ADB ₱15,000.00; interest ₱73.97", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "10,000.00")).ok).toBe(true);
    on("2026-02-15"); // Jan 1–Feb 14 = 45 days at ₱10,000; Feb 15–Mar 31 = 45 days at ₱20,000
    expect((await deposit(m, a, "10,000.00")).ok).toBe(true);
    on("2026-04-01");
    const [row] = (await previewInterest(await productId("SAV"), "2026-03-31")).filter((p) => p.accountId === a);
    expect(row).toMatchObject({ adb: P(15000), interest: P(73, 97) });
    const r = await runQ1();
    if (!r.ok) throw new Error(r.error);
    expect(await interestCredited(a)).toBe(P(73, 97));
  });

  it("A9.6 ADB ₱400.00 → interest ₱0.00", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "400.00")).ok).toBe(true);
    on("2026-04-01");
    const [row] = (await previewInterest(await productId("SAV"), "2026-03-31")).filter((p) => p.accountId === a);
    expect(row).toMatchObject({ adb: P(400), interest: 0n });
    expect((await runQ1()).ok).toBe(true);
    expect(await interestCredited(a)).toBe(0n);
    expect(await accountBalance(a)).toBe(P(400));
  });

  it("A9.7 run the same product and quarter twice → second run rejected \"already run\"; the GL has exactly one interest entry", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "10,000.00")).ok).toBe(true);
    const first = await runQ1();
    if (!first.ok) throw new Error(first.error);
    const second = await runQ1();
    expect(second).toMatchObject({ ok: false, error: expect.stringMatching(/already run/) });
    const entries = await getDb().select().from(journalEntries).where(eq(journalEntries.sourceModule, "savings-interest"));
    expect(entries).toHaveLength(1);
    expect(await interestCredited(a)).toBe(P(49, 32));
  });

  it("A9.8 TD ₱50,000.00 at 3% p.a. for 180 days, held to maturity → interest ₱739.73", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "50,100.00")).ok).toBe(true);
    const placed = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: a, principal: "50,000.00", termDays: 180 }));
    if (!placed.ok) throw new Error(placed.error);
    on("2026-06-30"); // 180 days after Jan 1
    const r = await runAs(await tellerToday(), () => matureTimeDepositAction({ timeDepositId: placed.data.timeDepositId }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.interest).toBe(String(P(739, 73)));
    expect(await accountBalance(a)).toBe(P(100) + P(50000) + P(739, 73));
  });

  it("A9.9 the same TD pre-terminated on day 90 (savings rate 2%) → interest ₱246.58", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "50,100.00")).ok).toBe(true);
    const placed = await runAs(await tellerToday(), async () => placeTimeDepositAction({ memberId: m, productId: await productId("TD"), fromAccountId: a, principal: "50,000.00", termDays: 180 }));
    if (!placed.ok) throw new Error(placed.error);
    on("2026-04-01"); // day 90 after Jan 1
    const r = await runAs(await tellerToday(), () => preterminateTimeDepositAction({ timeDepositId: placed.data.timeDepositId }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.interest).toBe(String(P(246, 58)));
  });

  it("A9.10 no customer txn for 24 months → dormancy job marks DORMANT; a deposit reopens it; the job twice on one date changes nothing", async () => {
    const m = await activeMember();
    const a = await openSavings(m);
    expect((await deposit(m, a, "1,000.00")).ok).toBe(true);
    await fiscalYear(2027);
    await fiscalYear(2028);
    on("2027-12-31");
    await runDailyJobs("2027-12-31");
    expect((await getAccount(a))?.status).toBe("OPEN");
    on("2028-01-01"); // 24 months after the last deposit
    await runDailyJobs("2028-01-01");
    expect((await getAccount(a))?.status).toBe("DORMANT");
    const again = await runDailyJobs("2028-01-01");
    expect(again.find((o) => o.job === "savings-dormancy")?.status).toBe("skipped");
    expect((await getAccount(a))?.status).toBe("DORMANT");
    expect((await deposit(m, a, "500.00")).ok).toBe(true);
    expect((await getAccount(a))?.status).toBe("OPEN");
  });
});
