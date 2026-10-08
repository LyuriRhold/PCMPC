import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { approveJvAction, createJvDraftAction } from "@/modules/ledger/actions";
import { accounts, journalEntries, journalLines, periods } from "@/modules/ledger/schema";
import {
  generalLedger,
  postJournal,
  reverseJournal,
  subsidiaryLedger,
  trialBalance,
  type PostJournalInput,
} from "@/modules/ledger/service";
import { makeUser } from "../helpers/phase01";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";
import { acct, P, seedLedger } from "../helpers/phase03";

// Golden values from docs/phases/PHASE-03-accounting-core.md › Acceptance tests.

beforeEach(seedLedger);

const post = (input: PostJournalInput) => withTx((tx) => postJournal(tx, input, null));

async function postA35() {
  const [cash, share, loans, interest] = await Promise.all([
    acct("cash_on_hand"),
    acct("subscribed_share_capital_common"),
    acct("loans_receivable_REG"),
    acct("interest_income_loans"),
  ]);
  // Share capital is a member-subsidiary account, so the line carries a member.
  const mgr = await makeUser("MANAGER", "mgr_a35");
  const memberId = await createApplicantAs(mgr.id, applicant());
  await approveAs(mgr.id, memberId);

  const a = await post({
    date: "2026-10-01",
    book: "CRJ",
    particulars: "Share capital payment",
    lines: [
      { accountId: cash, debit: P(50000) },
      { accountId: share, credit: P(50000), memberId },
    ],
  });
  const b = await post({
    date: "2026-10-02",
    book: "CDJ",
    particulars: "Loan release",
    lines: [
      { accountId: loans, debit: P(20000), memberId },
      { accountId: cash, credit: P(20000) },
    ],
  });
  const c = await post({
    date: "2026-10-03",
    book: "CRJ",
    particulars: "Interest collected",
    lines: [
      { accountId: cash, debit: P(1500) },
      { accountId: interest, credit: P(1500) },
    ],
  });
  return { a, b, c, cash, share, loans, interest, memberId };
}

function tbRow(tb: Awaited<ReturnType<typeof trialBalance>>, accountId: string) {
  const row = tb.rows.find((r) => r.accountId === accountId);
  return { debit: row?.debit ?? 0n, credit: row?.credit ?? 0n };
}

describe("Phase 03 acceptance", () => {
  it('A3.1 Dr Cash 1,000.00 / Cr Share Capital 999.99 → "Entry is not balanced (₱1,000.00 vs ₱999.99)"', async () => {
    // Balance is checked before anything else, so the Share Capital line needs no member here.
    const [cash, share] = await Promise.all([acct("cash_on_hand"), acct("subscribed_share_capital_common")]);
    await expect(
      post({
        date: "2026-10-07",
        book: "GJ",
        particulars: "Unbalanced",
        lines: [
          { accountId: cash, debit: P(1000) },
          { accountId: share, credit: P(999, 99) },
        ],
      }),
    ).rejects.toThrow("Entry is not balanced (₱1,000.00 vs ₱999.99)");
  });

  it("A3.2 posting to a header (non-postable) account → rejected", async () => {
    const [header] = await getDb().select().from(accounts).where(eq(accounts.isPostable, false)).limit(1);
    const cash = await acct("cash_on_hand");
    expect(header).toBeDefined();
    await expect(
      post({
        date: "2026-10-07",
        book: "GJ",
        particulars: "Header",
        lines: [
          { accountId: cash, debit: P(100) },
          { accountId: header!.id, credit: P(100) },
        ],
      }),
    ).rejects.toThrow(/not postable/);
  });

  it('A3.3 post dated 2026-09-15 when Sep 2026 is CLOSED → "Period 2026-09 is closed"', async () => {
    await getDb()
      .update(periods)
      .set({ status: "CLOSED" })
      .where(and(eq(periods.year, 2026), eq(periods.month, 9)));
    const [cash, fee] = await Promise.all([acct("cash_on_hand"), acct("membership_fee_income")]);
    await expect(
      post({
        date: "2026-09-15",
        book: "GJ",
        particulars: "Closed period",
        lines: [
          { accountId: cash, debit: P(500) },
          { accountId: fee, credit: P(500) },
        ],
      }),
    ).rejects.toThrow("Period 2026-09 is closed");
  });

  it("A3.4 first valid GJ entry in 2026 → GJ-2026-00001, POSTED", async () => {
    const [cash, fee] = await Promise.all([acct("cash_on_hand"), acct("membership_fee_income")]);
    const je = await post({
      date: "2026-10-07",
      book: "GJ",
      particulars: "Membership fee",
      lines: [
        { accountId: cash, debit: P(500) },
        { accountId: fee, credit: P(500) },
      ],
    });
    expect(je.jeNo).toBe("GJ-2026-00001");
    expect(je.status).toBe("POSTED");
  });

  it("A3.5 TB after (a)(b)(c): Cash 31,500 Dr · Loans 20,000 Dr · Share Capital 50,000 Cr · Interest 1,500 Cr · ₱51,500.00 = ₱51,500.00", async () => {
    const { cash, share, loans, interest } = await postA35();
    const tb = await trialBalance("2026-10-31");
    expect(tbRow(tb, cash)).toEqual({ debit: P(31500), credit: 0n });
    expect(tbRow(tb, loans)).toEqual({ debit: P(20000), credit: 0n });
    expect(tbRow(tb, share)).toEqual({ debit: 0n, credit: P(50000) });
    expect(tbRow(tb, interest)).toEqual({ debit: 0n, credit: P(1500) });
    expect(tb.totalDebit).toBe(P(51500));
    expect(tb.totalCredit).toBe(P(51500));
  });

  it("A3.6 reverse (c) → mirror entry, (c) REVERSED, TB Cash 30,000 Dr, Interest 0; reversing (c) again → rejected", async () => {
    const { c, cash, interest } = await postA35();
    const rev = await withTx((tx) => reverseJournal(tx, c.id, "2026-10-05", "Posted to the wrong member", null));

    const revLines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, rev.id));
    expect(rev.reversalOfId).toBe(c.id);
    expect(rev.book).toBe("CRJ");
    expect(revLines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })).sort((x, y) => (x.accountId < y.accountId ? -1 : 1))).toEqual(
      [
        { accountId: cash, debit: 0n, credit: P(1500) },
        { accountId: interest, debit: P(1500), credit: 0n },
      ].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)),
    );
    const [original] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, c.id));
    expect(original?.status).toBe("REVERSED");
    expect(original?.reversedById).toBe(rev.id);

    const tb = await trialBalance("2026-10-31");
    expect(tbRow(tb, cash)).toEqual({ debit: P(30000), credit: 0n });
    expect(tbRow(tb, interest)).toEqual({ debit: 0n, credit: 0n });

    await expect(withTx((tx) => reverseJournal(tx, c.id, "2026-10-06", "again", null))).rejects.toThrow(/already reversed/);
  });

  it("A3.7 raw SQL UPDATE journal_lines SET debit=… on (a) → DB error (trigger)", async () => {
    const { a } = await postA35();
    await expect(getDb().execute(sql`UPDATE journal_lines SET debit = 1 WHERE je_id = ${a.id} AND debit > 0`)).rejects.toThrow();
    await expect(getDb().execute(sql`DELETE FROM journal_lines WHERE je_id = ${a.id}`)).rejects.toThrow();
  });

  it("A3.8 JV prepared by book1, approved by book1 → Forbidden (SoD); approved by mgr1 → POSTED", async () => {
    const book1 = await makeUser("BOOKKEEPER", "book1");
    const mgr1 = await makeUser("MANAGER", "mgr1");
    const [cash, fee] = await Promise.all([acct("cash_on_hand"), acct("membership_fee_income")]);

    const draft = await runAs(book1.id, () =>
      createJvDraftAction({
        date: "2026-10-07",
        particulars: "Correct membership fee",
        reference: "JV memo 1",
        lines: [
          { accountId: cash, debit: "500.00", credit: "", memberNo: "", memo: "" },
          { accountId: fee, debit: "", credit: "500.00", memberNo: "", memo: "" },
        ],
      }),
    );
    if (!draft.ok) throw new Error(draft.error);

    await expect(runAs(book1.id, () => approveJvAction({ jeId: draft.data.id }))).rejects.toThrow(
      "Segregation of duties: preparer cannot approve",
    );
    const approved = await runAs(mgr1.id, () => approveJvAction({ jeId: draft.data.id }));
    expect(approved).toMatchObject({ ok: true, data: { jeNo: "GJ-2026-00001" } });
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, draft.data.id));
    expect(je).toMatchObject({ status: "POSTED", preparedBy: book1.id, approvedBy: mgr1.id });
  });

  it("A3.9 GL for Cash after A3.5 → running balances 50,000.00 → 30,000.00 → 31,500.00", async () => {
    const { cash } = await postA35();
    const gl = await generalLedger(cash, "2026-10-01", "2026-10-31");
    expect(gl.opening).toBe(0n);
    expect(gl.lines.map((l) => l.running)).toEqual([P(50000), P(30000), P(31500)]);
    expect(gl.closing).toBe(P(31500));
    expect(gl.side).toBe("DR");
  });

  it("A3.10 savings_deposits for M-000001: Cr 2,000, Dr 500 → subsidiary balance ₱1,500.00 Cr; a line without member_id → rejected", async () => {
    const mgr = await makeUser("MANAGER", "mgr1");
    const memberId = await createApplicantAs(mgr.id, applicant());
    expect(await approveAs(mgr.id, memberId)).toBe("M-000001");
    const [cash, savings] = await Promise.all([acct("cash_on_hand"), acct("savings_deposits")]);

    await post({
      date: "2026-10-02",
      book: "CRJ",
      particulars: "Savings deposit",
      lines: [
        { accountId: cash, debit: P(2000) },
        { accountId: savings, credit: P(2000), memberId },
      ],
    });
    await post({
      date: "2026-10-04",
      book: "CDJ",
      particulars: "Savings withdrawal",
      lines: [
        { accountId: savings, debit: P(500), memberId },
        { accountId: cash, credit: P(500) },
      ],
    });
    const sub = await subsidiaryLedger("savings_deposits", memberId, "2026-10-01", "2026-10-31");
    expect(sub.closing).toBe(P(1500));
    expect(sub.side).toBe("CR");

    await expect(
      post({
        date: "2026-10-05",
        book: "CRJ",
        particulars: "No member",
        lines: [
          { accountId: cash, debit: P(100) },
          { accountId: savings, credit: P(100) },
        ],
      }),
    ).rejects.toThrow(/member/i);
  });
});
