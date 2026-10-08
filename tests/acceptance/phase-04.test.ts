import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import {
  approveDvAction,
  bankDepositAction,
  cancelReceiptAction,
  closeSessionAction,
  createDvAction,
  releaseDvAction,
  verifySessionAction,
} from "@/modules/cashiering/actions";
import { cashPosition } from "@/modules/cashiering/cash-position";
import { registerReceiptItem, unregisterReceiptItem } from "@/modules/cashiering/registry";
import { receipts, tellerSessions } from "@/modules/cashiering/schema";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountBalance } from "@/modules/ledger/service";
import { updateSetting } from "@/modules/settings/service";
import { acct, P } from "../helpers/phase03";
import { DAY, openSessionAs, receiptAs, setupCashiering, YESTERDAY } from "../helpers/phase04";

// Golden values from docs/phases/PHASE-04-cashiering.md › Acceptance tests.

let teller = "";
let manager = "";
let book = "";

beforeEach(async () => {
  const users = await setupCashiering();
  teller = users.teller.id;
  manager = users.manager.id;
  book = users.book.id;
});
afterEach(() => {
  setClock(null);
  unregisterReceiptItem("TEST_THROWS");
});

async function linesOf(jeId: string) {
  const rows = await getDb().select().from(journalLines).where(eq(journalLines.jeId, jeId));
  return rows.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }));
}

/** Teller-released cash DV for `amount` pesos (bookkeeper prepares, manager approves). */
async function releasedCashDv(amount: string) {
  const dv = await runAs(book, () =>
    createDvAction({
      date: "2026-10-07",
      payee: "Pipindan Hardware",
      particulars: "Office supplies",
      mode: "CASH",
      checkNo: null,
      lines: [{ accountId: "", mappingKey: "cash_short_over", amount, memberNo: "", memo: "" }],
    }),
  );
  if (!dv.ok) throw new Error(dv.error);
  const approved = await runAs(manager, () => approveDvAction({ dvId: dv.data.id }));
  if (!approved.ok) throw new Error(approved.error);
  const released = await runAs(teller, () => releaseDvAction({ dvId: dv.data.id }));
  if (!released.ok) throw new Error(released.error);
  return { dvId: dv.data.id, jeId: released.data.jeId };
}

describe("Phase 04 acceptance", () => {
  it('A4.1 teller without an open session issues a receipt → "Open a teller session first"', async () => {
    expect(await receiptAs(teller, [["CERT_FEE", "50.00"]])).toEqual({ ok: false, error: "Open a teller session first" });
  });

  it("A4.2 OTHER_INCOME certification fee ₱50.00 + hall rental ₱1,500.00 → AR-2026-000001, ₱1,550.00, one CRJ entry", async () => {
    await openSessionAs(teller);
    const r = await receiptAs(teller, [
      ["CERT_FEE", "50.00"],
      ["HALL_RENTAL", "1,500.00"],
    ]);
    expect(r).toMatchObject({ ok: true, data: { receiptNo: "AR-2026-000001", total: "155000" } });
    if (!r.ok) return;

    const [receipt] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    const entries = await getDb().select().from(journalEntries).where(eq(journalEntries.sourceId, r.data.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ book: "CRJ", status: "POSTED", id: receipt?.jeId });

    const [cash, cert, rent] = await Promise.all([acct("cash_on_hand"), acct("certification_fee_income"), acct("rental_income")]);
    expect((await linesOf(entries[0]!.id)).sort((a, b) => (a.accountId < b.accountId ? -1 : 1))).toEqual(
      [
        { accountId: cash, debit: P(1550), credit: 0n },
        { accountId: cert, debit: 0n, credit: P(50) },
        { accountId: rent, debit: 0n, credit: P(1500) },
      ].sort((a, b) => (a.accountId < b.accountId ? -1 : 1)),
    );
  });

  it("A4.3 an item whose apply throws (test-only type) → whole receipt rejected, no JE; next valid receipt is AR-2026-000001", async () => {
    registerReceiptItem({
      type: "TEST_THROWS",
      label: "Test item that fails",
      permission: "cash.receipt",
      validate: async () => {},
      apply: async () => {
        throw new Error("apply failed on purpose");
      },
      reverse: async () => {},
    });
    await openSessionAs(teller);
    await expect(
      runAs(teller, async () => {
        const { issueReceiptAction } = await import("@/modules/cashiering/actions");
        return issueReceiptAction({
          payor: { type: "WALK_IN", id: null, name: "Walk-in" },
          mode: "CASH",
          checkNo: null,
          birReceiptNo: "BIR-1",
          items: [
            { type: "OTHER_INCOME", refId: "CERT_FEE", amount: "50.00", description: null },
            { type: "TEST_THROWS", refId: null, amount: "10.00", description: null },
          ],
        });
      }),
    ).rejects.toThrow("apply failed on purpose");
    expect(await getDb().select().from(journalEntries)).toHaveLength(0);
    expect(await getDb().select().from(receipts)).toHaveLength(0);

    const ok = await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    expect(ok).toMatchObject({ ok: true, data: { receiptNo: "AR-2026-000001" } });
  });

  it("A4.4 supervisor cancels A4.2 the same day → reversal JE, CANCELLED, next receipt AR-2026-000002", async () => {
    await openSessionAs(teller);
    const r = await receiptAs(teller, [
      ["CERT_FEE", "50.00"],
      ["HALL_RENTAL", "1,500.00"],
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: r.data.id, reason: "Wrong payor" }))).toEqual({ ok: true, data: undefined });

    const [receipt] = await getDb().select().from(receipts).where(eq(receipts.id, r.data.id));
    expect(receipt?.status).toBe("CANCELLED");
    const [original] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, receipt!.jeId));
    expect(original?.status).toBe("REVERSED");
    const [reversal] = await getDb().select().from(journalEntries).where(eq(journalEntries.reversalOfId, receipt!.jeId));
    expect(reversal).toBeDefined();
    expect((await accountBalance(await acct("cash_on_hand"), "2026-10-07")).net).toBe(0n);

    expect(await receiptAs(teller, [["CERT_FEE", "50.00"]])).toMatchObject({ ok: true, data: { receiptNo: "AR-2026-000002" } });
  });

  it("A4.5 teller cancels own receipt → Forbidden; supervisor cancels a receipt from yesterday → rejected", async () => {
    setClock(() => YESTERDAY);
    await openSessionAs(teller);
    const old = await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    if (!old.ok) throw new Error(old.error);
    await expect(runAs(teller, () => cancelReceiptAction({ receiptId: old.data.id, reason: "mine" }))).rejects.toBeInstanceOf(ForbiddenError);

    setClock(() => DAY);
    const r = await runAs(manager, () => cancelReceiptAction({ receiptId: old.data.id, reason: "late" }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/same business day|today/i) });
    const [receipt] = await getDb().select().from(receipts).where(eq(receipts.id, old.data.id));
    expect(receipt?.status).toBe("VALID");
  });

  it("A4.6 opening ₱5,000.00; receipts ₱4,416.80; DV cash release ₱1,000.00; counted ₱8,400.00 → expected ₱8,416.80, variance −₱16.80; verify → Dr Cash Short/Over 16.80 / Cr Cash 16.80", async () => {
    const sessionId = await openSessionAs(teller, "5,000.00");
    expect((await receiptAs(teller, [["HALL_RENTAL", "4,416.80"]])).ok).toBe(true);
    await releasedCashDv("1,000.00");

    const closed = await runAs(teller, () =>
      closeSessionAction({
        sessionId,
        counts: [
          { denomination: "1000", qty: 8 },
          { denomination: "100", qty: 4 },
        ],
      }),
    );
    expect(closed).toEqual({ ok: true, data: { expected: "841680", counted: "840000", variance: "-1680" } });

    const verified = await runAs(manager, () => verifySessionAction({ sessionId }));
    if (!verified.ok) throw new Error(verified.error);
    const [session] = await getDb().select().from(tellerSessions).where(eq(tellerSessions.id, sessionId));
    expect(session).toMatchObject({ status: "VERIFIED", expectedCash: P(8416, 80), countedCash: P(8400), variance: -P(16, 80), verifiedBy: manager });

    const [cash, shortOver] = await Promise.all([acct("cash_on_hand"), acct("cash_short_over")]);
    expect((await linesOf(session!.varianceJeId!)).sort((a, b) => (a.accountId < b.accountId ? -1 : 1))).toEqual(
      [
        { accountId: shortOver, debit: P(16, 80), credit: 0n },
        { accountId: cash, debit: 0n, credit: P(16, 80) },
      ].sort((a, b) => (a.accountId < b.accountId ? -1 : 1)),
    );
  });

  it("A4.7 receipt after the session is CLOSED → rejected", async () => {
    const sessionId = await openSessionAs(teller, "0.00");
    const c = await runAs(teller, () => closeSessionAction({ sessionId, counts: [] }));
    expect(c.ok).toBe(true);
    const r = await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    expect(r.ok).toBe(false);
  });

  it("A4.8 DV prepared and approved by the same user → Forbidden; approved by the manager → released → CDJ entry", async () => {
    await openSessionAs(teller);
    const dv = await runAs(book, () =>
      createDvAction({
        date: "2026-10-07",
        payee: "Meralco",
        particulars: "Electricity",
        mode: "CASH",
        checkNo: null,
        lines: [{ accountId: "", mappingKey: "cash_short_over", amount: "2,500.00", memberNo: "", memo: "" }],
      }),
    );
    if (!dv.ok) throw new Error(dv.error);
    await expect(runAs(book, () => approveDvAction({ dvId: dv.data.id }))).rejects.toBeInstanceOf(ForbiddenError);

    expect(await runAs(manager, () => approveDvAction({ dvId: dv.data.id }))).toEqual({ ok: true, data: undefined });
    const released = await runAs(teller, () => releaseDvAction({ dvId: dv.data.id }));
    if (!released.ok) throw new Error(released.error);
    const [je] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, released.data.jeId));
    expect(je).toMatchObject({ book: "CDJ", status: "POSTED" });
  });

  it("A4.9 cash.require_bir_receipt_no = true and no BIR receipt no. → rejected", async () => {
    await withTx((tx) => updateSetting(tx, "cash.require_bir_receipt_no", true, null));
    await openSessionAs(teller);
    const r = await receiptAs(teller, [["CERT_FEE", "50.00"]], "");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/BIR receipt no/i) });
  });

  it("A4.10 daily cash position for the fixture day → ending cash = GL Cash on Hand as of that date", async () => {
    await openSessionAs(teller, "5,000.00");
    await receiptAs(teller, [["HALL_RENTAL", "4,416.80"]]);
    await receiptAs(teller, [["CERT_FEE", "150.00"]], "BIR-0002");
    await releasedCashDv("1,000.00");
    expect((await runAs(teller, () => bankDepositAction({ amount: "2,000.00", bankReference: "DS-001" }))).ok).toBe(true);

    const pos = await cashPosition("2026-10-07");
    const gl = await accountBalance(await acct("cash_on_hand"), "2026-10-07");
    expect(pos.ending).toBe(gl.net);
    expect(pos.ending).toBe(P(1566, 80));
    expect(pos.reconciled).toBe(true);
  });
});
