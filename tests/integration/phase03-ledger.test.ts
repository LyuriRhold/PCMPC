import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { auditLog } from "@/modules/audit/schema";
import { approveJvAction, createAccountAction, createJvDraftAction, discardJvAction, reverseJvAction, setAccountActiveAction } from "@/modules/ledger/actions";
import { accounts, journalEntries, periods } from "@/modules/ledger/schema";
import { accountBalance, journalBook, postJournal, type PostJournalInput } from "@/modules/ledger/service";
import { makeUser } from "../helpers/phase01";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";
import { acct, P, seedLedger } from "../helpers/phase03";

beforeEach(seedLedger);

const post = (input: PostJournalInput) => withTx((tx) => postJournal(tx, input, null));

async function feeEntry(date = "2026-10-07", book: PostJournalInput["book"] = "GJ"): Promise<PostJournalInput> {
  return {
    date,
    book,
    particulars: "Membership fee",
    lines: [
      { accountId: await acct("cash_on_hand"), debit: P(500) },
      { accountId: await acct("membership_fee_income"), credit: P(500) },
    ],
  };
}

describe("T3.3 postJournal rules", () => {
  it("rejects a missing period, too few lines, two-sided lines, negative amounts and blank particulars", async () => {
    await expect(post(await feeEntry("2031-01-15"))).rejects.toThrow("Period 2031-01 is not set up");
    const base = await feeEntry();
    await expect(post({ ...base, lines: base.lines.slice(0, 1) })).rejects.toThrow(/at least two lines/);
    await expect(post({ ...base, lines: [{ ...base.lines[0]!, credit: P(1) }, base.lines[1]!] })).rejects.toThrow(/either a debit or a credit/);
    await expect(post({ ...base, lines: [{ ...base.lines[0]!, debit: -P(500) }, base.lines[1]!] })).rejects.toThrow(/negative/);
    await expect(post({ ...base, particulars: "  " })).rejects.toThrow(/Particulars/);
  });

  it("rejects inactive accounts and unknown members", async () => {
    const base = await feeEntry();
    const [inactive] = await getDb()
      .insert(accounts)
      .values({ code: "44190", name: "Old income", type: "REVENUE", normalBalance: "CR", isPostable: true, isActive: false })
      .returning();
    await expect(post({ ...base, lines: [base.lines[0]!, { accountId: inactive!.id, credit: P(500) }] })).rejects.toThrow(/inactive/);
    await expect(
      post({ ...base, lines: [base.lines[0]!, { ...base.lines[1]!, memberId: "00000000-0000-4000-8000-00000000abcd" }] }),
    ).rejects.toThrow(/unknown member/);
  });

  it("numbers each book separately, writes an audit row, and rolls back with the business record", async () => {
    const gj = await post(await feeEntry());
    const crj = await post(await feeEntry("2026-10-07", "CRJ"));
    expect([gj.jeNo, crj.jeNo]).toEqual(["GJ-2026-00001", "CRJ-2026-00001"]);
    const rows = await getDb().select().from(auditLog).where(and(eq(auditLog.action, "je.post"), eq(auditLog.entityId, gj.id)));
    expect(rows).toHaveLength(1);

    // A failure after posting rolls back the entry and frees its number.
    await expect(
      withTx(async (tx) => {
        await postJournal(tx, await feeEntry(), null);
        throw new Error("business record failed");
      }),
    ).rejects.toThrow("business record failed");
    expect((await post(await feeEntry())).jeNo).toBe("GJ-2026-00002");
    expect((await accountBalance(await acct("cash_on_hand"), "2026-10-31")).net).toBe(P(1500));
  });

  it("reversals: a reversal can't itself be reversed; journal book lists both entries", async () => {
    const je = await post(await feeEntry());
    const actor = await makeUser("MANAGER", "mgr1");
    const rev = await runAs(actor.id, () => reverseJvAction({ jeId: je.id, date: "2026-10-08", reason: "Wrong amount" }));
    expect(rev).toEqual({ ok: true, data: { jeNo: "GJ-2026-00002" } });
    const [revRow] = await getDb().select().from(journalEntries).where(eq(journalEntries.jeNo, "GJ-2026-00002"));
    expect(await runAs(actor.id, () => reverseJvAction({ jeId: revRow!.id, reason: "again" }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/itself a reversal/),
    });
    const book = await journalBook("GJ", "2026-10-01", "2026-10-31");
    expect(book.map((e) => [e.jeNo, e.status, e.lines.length])).toEqual([
      ["GJ-2026-00001", "REVERSED", 2],
      ["GJ-2026-00002", "POSTED", 2],
    ]);
  });
});

describe("T3.4 manual JV workflow", () => {
  async function draftAs(userId: string, overrides: Partial<{ date: string; memberNo: string; debit: string }> = {}) {
    const cash = await acct("cash_on_hand");
    const savings = await acct("savings_deposits");
    return runAs(userId, () =>
      createJvDraftAction({
        date: overrides.date ?? "2026-10-07",
        particulars: "Savings correction",
        lines: [
          { accountId: cash, debit: overrides.debit ?? "1,250.50", credit: "", memberNo: "", memo: "" },
          { accountId: savings, debit: "", credit: "1250.50", memberNo: overrides.memberNo ?? "", memo: "per member" },
        ],
      }),
    );
  }

  it("resolves member numbers, rejects unknown members and bad amounts, and keeps drafts unnumbered", async () => {
    const book1 = await makeUser("BOOKKEEPER", "book1");
    const mgr = await makeUser("MANAGER", "mgr1");
    const memberId = await createApplicantAs(mgr.id, applicant());
    await approveAs(mgr.id, memberId);

    expect(await draftAs(book1.id)).toMatchObject({ ok: false, error: expect.stringMatching(/member subsidiary ledger/) });
    expect(await draftAs(book1.id, { memberNo: "M-999999" })).toMatchObject({ ok: false, error: "Line 2: member M-999999 not found" });
    expect(await draftAs(book1.id, { memberNo: "m-000001", debit: "12x" })).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid amount/) });
    const ok = await draftAs(book1.id, { memberNo: "m-000001" });
    if (!ok.ok) throw new Error(ok.error);
    const [draft] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, ok.data.id));
    expect(draft).toMatchObject({ status: "DRAFT", jeNo: null, book: "GJ", preparedBy: book1.id });
  });

  it("approval re-checks the period; posted JVs can't be approved again; drafts can be discarded", async () => {
    const book1 = await makeUser("BOOKKEEPER", "book1");
    const mgr = await makeUser("MANAGER", "mgr1");
    const memberId = await createApplicantAs(mgr.id, applicant());
    await approveAs(mgr.id, memberId);

    const a = await draftAs(book1.id, { memberNo: "M-000001" });
    const b = await draftAs(book1.id, { memberNo: "M-000001" });
    if (!a.ok || !b.ok) throw new Error("drafts failed");
    await getDb().update(periods).set({ status: "CLOSED" }).where(and(eq(periods.year, 2026), eq(periods.month, 10)));
    expect(await runAs(mgr.id, () => approveJvAction({ jeId: a.data.id }))).toEqual({ ok: false, error: "Period 2026-10 is closed" });
    await getDb().update(periods).set({ status: "OPEN" }).where(and(eq(periods.year, 2026), eq(periods.month, 10)));
    expect(await runAs(mgr.id, () => approveJvAction({ jeId: a.data.id }))).toEqual({ ok: true, data: { jeNo: "GJ-2026-00001" } });
    expect(await runAs(mgr.id, () => approveJvAction({ jeId: a.data.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/already POSTED/) });

    expect(await runAs(book1.id, () => discardJvAction({ jeId: b.data.id }))).toEqual({ ok: true, data: undefined });
    expect(await getDb().select().from(journalEntries).where(eq(journalEntries.id, b.data.id))).toHaveLength(0);
    expect(await runAs(book1.id, () => discardJvAction({ jeId: a.data.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/Only drafts/) });
  });
});

describe("T3.6 chart of accounts rules", () => {
  it("adds accounts under headers only, and blocks deactivating mapped, non-zero or parent accounts", async () => {
    const book1 = await makeUser("BOOKKEEPER", "book1");
    const [header] = await getDb().select().from(accounts).where(eq(accounts.code, "53000"));
    const [postable] = await getDb().select().from(accounts).where(eq(accounts.code, "53110"));

    const created = await runAs(book1.id, () =>
      createAccountAction({ code: "53140", name: "Office Supplies", type: "EXPENSE", normalBalance: "DR", parentId: header!.id, isPostable: true, scaCode: null }),
    );
    expect(created.ok).toBe(true);
    expect(
      await runAs(book1.id, () =>
        createAccountAction({ code: "53150", name: "Bad parent", type: "EXPENSE", normalBalance: "DR", parentId: postable!.id, isPostable: true, scaCode: null }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/header account/) });
    expect(
      await runAs(book1.id, () =>
        createAccountAction({ code: "53140", name: "Dup", type: "EXPENSE", normalBalance: "DR", parentId: header!.id, isPostable: true, scaCode: null }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });

    if (!created.ok) return;
    // Unused, unmapped account: can be deactivated and reactivated.
    expect(await runAs(book1.id, () => setAccountActiveAction({ accountId: created.data.id, active: false }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(book1.id, () => setAccountActiveAction({ accountId: created.data.id, active: true }))).toEqual({ ok: true, data: undefined });

    // With a balance: blocked.
    await post({
      date: "2026-10-07",
      book: "CDJ",
      particulars: "Supplies",
      lines: [
        { accountId: created.data.id, debit: P(250) },
        { accountId: await acct("cash_on_hand"), credit: P(250) },
      ],
    });
    expect(await runAs(book1.id, () => setAccountActiveAction({ accountId: created.data.id, active: false }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/has a balance/),
    });
    // Mapped (no balance): blocked. Header with active children: blocked.
    expect(await runAs(book1.id, () => setAccountActiveAction({ accountId: postable!.id, active: false }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/depreciation_expense/),
    });
    expect(await runAs(book1.id, () => setAccountActiveAction({ accountId: header!.id, active: false }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/sub-accounts/),
    });
  });
});
