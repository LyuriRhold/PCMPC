import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { journalLines } from "@/modules/ledger/schema";
import { transferAction } from "@/modules/share/actions";
import { averageShareMonth, isGoodStanding, memberShareLedger, shareBalance } from "@/modules/share/service";
import { acct, P } from "../helpers/phase03";
import { at, fillers, member, pay, receipt, setupShares, subscribe } from "../helpers/phase08";

// Golden values from docs/phases/PHASE-08-share-capital.md › Acceptance tests (par ₱100, fee ₱500, cap 10%).

let manager = "";
beforeEach(async () => {
  const u = await setupShares();
  manager = u.manager.id;
});
afterEach(() => setClock(null));

async function linesOf(jeId: string) {
  const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, jeId));
  return lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memberId: l.memberId }));
}

/** Paid-up per the GL subsidiary: subscribed share capital (credit) less subscription receivable (debit). */
async function glPaidUp(memberId: string, jeIds?: string[]) {
  const [cap, rec] = await Promise.all([acct("subscribed_share_capital_common"), acct("subscription_receivable_common")]);
  const conds = [eq(journalLines.memberId, memberId), inArray(journalLines.accountId, [cap, rec])];
  if (jeIds) conds.push(jeIds.length ? inArray(journalLines.jeId, jeIds) : eq(journalLines.jeId, "00000000-0000-0000-0000-000000000000"));
  const lines = await getDb().select().from(journalLines).where(and(...conds));
  return lines.reduce((s, l) => s + (l.accountId === cap ? l.credit - l.debit : -(l.debit - l.credit)), 0n);
}

describe("Phase 08 acceptance", () => {
  it("A8.1 M-000001 subscribes 100 shares → subscribed ₱10,000.00, paid-up ₱0.00; GL Dr Subscription Receivable / Cr Subscribed Share Capital 10,000 (member-tagged)", async () => {
    const m = await member();
    const sub = await subscribe(m, 100);
    expect(await shareBalance(m)).toEqual({ subscribed: P(10000), paidUp: 0n, unpaid: P(10000) });
    const [rec, cap] = await Promise.all([acct("subscription_receivable_common"), acct("subscribed_share_capital_common")]);
    expect(await linesOf(sub.jeId)).toEqual(
      expect.arrayContaining([
        { accountId: rec, debit: P(10000), credit: 0n, memberId: m },
        { accountId: cap, debit: 0n, credit: P(10000), memberId: m },
      ]),
    );
    expect(await linesOf(sub.jeId)).toHaveLength(2);
  });

  it("A8.2 pays ₱2,500.00 → paid-up ₱2,500.00, unpaid ₱7,500.00; GL Dr Cash 2,500 / Cr Subscription Receivable 2,500", async () => {
    const m = await member();
    await subscribe(m, 100);
    const r = await pay(m, "2,500.00");
    if (!r.ok) throw new Error(r.error);
    expect(await shareBalance(m)).toEqual({ subscribed: P(10000), paidUp: P(2500), unpaid: P(7500) });
    const [cash, rec] = await Promise.all([acct("cash_on_hand"), acct("subscription_receivable_common")]);
    expect(await linesOf(r.data.jeId)).toEqual(
      expect.arrayContaining([
        { accountId: cash, debit: P(2500), credit: 0n, memberId: null },
        { accountId: rec, debit: 0n, credit: P(2500), memberId: m },
      ]),
    );
  });

  it('A8.3 pays ₱8,000.00 when unpaid is ₱7,500.00 → rejected "Payment exceeds unpaid subscription (₱7,500.00)"', async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "2,500.00")).ok).toBe(true);
    expect(await pay(m, "8,000.00")).toEqual({ ok: false, error: "Payment exceeds unpaid subscription (₱7,500.00)" });
  });

  it("A8.4 membership fee ₱500.00 → GL Dr Cash 500 / Cr Membership Fee Income 500; isGoodStanding = true (paid-up 2,500 ≥ 2,500)", async () => {
    const m = await member();
    await subscribe(m, 100);
    expect((await pay(m, "2,500.00")).ok).toBe(true);
    expect(await isGoodStanding(m)).toBe(false);
    const r = await receipt(m, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }]);
    if (!r.ok) throw new Error(r.error);
    const [cash, fee] = await Promise.all([acct("cash_on_hand"), acct("membership_fee_income")]);
    expect(await linesOf(r.data.jeId)).toEqual(
      expect.arrayContaining([
        { accountId: cash, debit: P(500), credit: 0n, memberId: null },
        { accountId: fee, debit: 0n, credit: P(500), memberId: null },
      ]),
    );
    expect(await isGoodStanding(m)).toBe(true);
  });

  it("A8.5 ASM 2026: A ₱12,000.00 paid-up all year; B ₱6,000.00 Jan–Jun and ₱12,000.00 Jul–Dec → ASM A ₱12,000.00, B ₱9,000.00", async () => {
    await fillers(44, "2026-01-02");
    setClock(() => at("2026-01-05"));
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 120);
    await subscribe(b, 120);
    expect((await pay(a, "12,000.00")).ok).toBe(true);
    expect((await pay(b, "6,000.00")).ok).toBe(true);
    setClock(() => at("2026-07-05"));
    expect((await pay(b, "6,000.00")).ok).toBe(true);
    expect(await averageShareMonth(a, 2026)).toBe(P(12000));
    expect(await averageShareMonth(b, 2026)).toBe(P(9000));
  });

  it("A8.6 coop total paid-up ₱100,000.00 of which C holds ₱9,000.00; C pays ₱2,000.00 → rejected: 11,000 / 102,000 = 10.78% > 10%", async () => {
    await fillers(36, "2026-10-01");
    const d = await member("Delta");
    await subscribe(d, 100);
    expect((await pay(d, "1,000.00")).ok).toBe(true);
    const c = await member("Charlie");
    await subscribe(c, 120);
    expect((await pay(c, "9,000.00")).ok).toBe(true);
    const { totalPaidUp } = await import("@/modules/share/service");
    expect(await totalPaidUp()).toBe(P(100000));
    expect(await pay(c, "2,000.00")).toEqual({ ok: false, error: expect.stringContaining("10.78%") });
    expect((await shareBalance(c)).paidUp).toBe(P(9000));
  });

  it("A8.7 transfer ₱1,000.00 paid-up A → B with BOD ref → A −1,000.00, B +1,000.00; TB control totals unchanged; subsidiary ledgers updated", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    await subscribe(b, 100);
    expect((await pay(a, "2,500.00")).ok).toBe(true);
    expect((await pay(b, "2,500.00")).ok).toBe(true);
    const r = await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1,000.00", bodRef: "BOD Res. 2026-21" }));
    if (!r.ok) throw new Error(r.error);
    expect((await shareBalance(a)).paidUp).toBe(P(1500));
    expect((await shareBalance(b)).paidUp).toBe(P(3500));
    const cap = await acct("subscribed_share_capital_common");
    const lines = await linesOf(r.data.jeId);
    expect(lines).toEqual(
      expect.arrayContaining([
        { accountId: cap, debit: P(1000), credit: 0n, memberId: a },
        { accountId: cap, debit: 0n, credit: P(1000), memberId: b },
      ]),
    );
    expect(lines.every((l) => l.accountId === cap)).toBe(true);
    expect(lines.reduce((s, l) => s + l.debit - l.credit, 0n)).toBe(0n);
    expect(await glPaidUp(a)).toBe(P(1500));
    expect(await glPaidUp(b)).toBe(P(3500));
  });

  it("A8.8 transfer without a BOD ref, or to an APPLICANT → rejected", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    expect((await pay(a, "2,500.00")).ok).toBe(true);
    expect(await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "1,000.00", bodRef: "" }))).toMatchObject({ ok: false });
    const { createApplicantAs, applicant } = await import("../helpers/phase02");
    const applicantId = await createApplicantAs(manager, applicant({ lastName: "Applicant", firstName: "Ana", birthdate: "1991-02-02", tin: null, validIdNo: "ID-APP" }));
    expect(await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: applicantId, amount: "1,000.00", bodRef: "BOD Res. 2026-21" }))).toMatchObject({ ok: false });
    expect((await shareBalance(a)).paidUp).toBe(P(2500));
  });

  it("A8.9 member share ledger for A → running balance equals the GL subsidiary balance for A at every row", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    await subscribe(b, 100);
    expect((await pay(a, "2,500.00")).ok).toBe(true);
    expect((await pay(b, "2,500.00")).ok).toBe(true);
    await subscribe(a, 20);
    expect((await runAs(manager, () => transferAction({ fromMemberId: b, toMemberId: a, amount: "500.00", bodRef: "BOD Res. 2026-22" }))).ok).toBe(true);
    expect((await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "300.00", bodRef: "BOD Res. 2026-23" }))).ok).toBe(true);

    const ledger = await memberShareLedger(a);
    expect(ledger.rows.length).toBeGreaterThanOrEqual(5);
    for (const [i, row] of ledger.rows.entries()) {
      const upTo = ledger.rows.slice(0, i + 1).map((r) => r.jeId);
      expect(row.paidUpBalance, `row ${i + 1} (${row.type})`).toBe(await glPaidUp(a, upTo));
    }
    expect(ledger.rows.at(-1)?.paidUpBalance).toBe(await glPaidUp(a));
    expect(ledger.rows.at(-1)?.paidUpBalance).toBe(P(2700));
  });
});
