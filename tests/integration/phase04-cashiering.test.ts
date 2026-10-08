import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { ForbiddenError, runAs, SodError } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import {
  approveDvAction,
  bankDepositAction,
  cancelDvAction,
  cancelReceiptAction,
  closeSessionAction,
  createDvAction,
  issueReceiptAction,
  openSessionAction,
  releaseDvAction,
  searchPayorsAction,
  verifySessionAction,
} from "@/modules/cashiering/actions";
import { cashPosition } from "@/modules/cashiering/cash-position";
import { cashOuts, disbursementVouchers, receipts, tellerSessions } from "@/modules/cashiering/schema";
import { verifySession } from "@/modules/cashiering/service";
import { journalLines } from "@/modules/ledger/schema";
import { accountBalance } from "@/modules/ledger/service";
import { makeUser } from "../helpers/phase01";
import { applicant, approveAs, createApplicantAs } from "../helpers/phase02";
import { acct, P } from "../helpers/phase03";
import { DAY, openSessionAs, receiptAs, setupCashiering, YESTERDAY } from "../helpers/phase04";

let teller = "";
let manager = "";
let book = "";
beforeEach(async () => {
  const u = await setupCashiering();
  teller = u.teller.id;
  manager = u.manager.id;
  book = u.book.id;
});
afterEach(() => setClock(null));

async function dv(mode: "CASH" | "CHECK", amount: string, checkNo: string | null = null) {
  const r = await runAs(book, () =>
    createDvAction({
      date: "2026-10-07",
      payee: "Supplier",
      particulars: "Supplies",
      mode,
      checkNo,
      lines: [{ accountId: "", mappingKey: "inventory_losses", amount, memberNo: "", memo: "" }],
    }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe("T4.3 sessions", () => {
  it("one open session per teller; a stale session from yesterday must be closed first", async () => {
    setClock(() => YESTERDAY);
    await openSessionAs(teller);
    setClock(() => DAY);
    expect(await runAs(teller, () => openSessionAction({ openingCash: "100" }))).toMatchObject({ ok: false, error: expect.stringMatching(/still open/) });
    expect(await receiptAs(teller, [["CERT_FEE", "50"]])).toMatchObject({ ok: false, error: expect.stringMatching(/close it and open today's session/) });
  });

  it("an over variance posts Dr Cash / Cr Short-Over; the teller can't verify their own session", async () => {
    const sessionId = await openSessionAs(teller, "100.00");
    await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    const closed = await runAs(teller, () =>
      closeSessionAction({
        sessionId,
        counts: [
          { denomination: "100", qty: 1 },
          { denomination: "20", kind: "COIN", qty: 3 },
        ],
      }),
    );
    expect(closed).toEqual({ ok: true, data: { expected: "15000", counted: "16000", variance: "1000" } });
    await expect(runAs(teller, () => verifySessionAction({ sessionId }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTx((tx) => verifySession(tx, sessionId, teller))).rejects.toBeInstanceOf(SodError);
    const v = await runAs(manager, () => verifySessionAction({ sessionId }));
    if (!v.ok || !v.data.varianceJeId) throw new Error("expected a variance entry");
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, v.data.varianceJeId));
    const cash = await acct("cash_on_hand");
    expect(lines.find((l) => l.accountId === cash)?.debit).toBe(P(10));
  });

  it("rejects unknown denominations and closing someone else's session", async () => {
    const sessionId = await openSessionAs(teller);
    expect(await runAs(teller, () => closeSessionAction({ sessionId, counts: [{ denomination: "300", qty: 1 }] }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a counted denomination/),
    });
    const other = await makeUser("TELLER", "teller2");
    expect(await runAs(other.id, () => closeSessionAction({ sessionId, counts: [] }))).toMatchObject({ ok: false, error: expect.stringMatching(/Only the teller/) });
  });
});

describe("T4.4 receipts", () => {
  it("member payors resolve on the server; checks need a number; bank transfers go to Cash in Bank and not the drawer", async () => {
    const memberId = await createApplicantAs(manager, applicant());
    await approveAs(manager, memberId);
    const sessionId = await openSessionAs(teller, "0");

    const found = await runAs(teller, () => searchPayorsAction({ type: "MEMBER", q: "dela cruz" }));
    expect(found).toMatchObject({ ok: true, data: [{ id: memberId, name: "Dela Cruz, Juan", detail: "M-000001 · ACTIVE" }] });

    const base = { birReceiptNo: "BIR-9", items: [{ type: "OTHER_INCOME", refId: "CERT_FEE", amount: "75.00", description: null }] };
    const member = await runAs(teller, () =>
      issueReceiptAction({ ...base, payor: { type: "MEMBER", id: memberId, name: "typed by client" }, mode: "CASH", checkNo: null }),
    );
    if (!member.ok) throw new Error(member.error);
    const [m] = await getDb().select().from(receipts).where(eq(receipts.id, member.data.id));
    expect(m?.payorName).toBe("Dela Cruz, Juan");

    expect(await runAs(teller, () => issueReceiptAction({ ...base, payor: { type: "WALK_IN", id: null, name: "X" }, mode: "CHECK", checkNo: null }))).toMatchObject({
      ok: false,
      error: "Enter the check number",
    });
    const bank = await runAs(teller, () => issueReceiptAction({ ...base, payor: { type: "WALK_IN", id: null, name: "X" }, mode: "BANK_TRANSFER", checkNo: null }));
    expect(bank.ok).toBe(true);
    expect((await accountBalance(await acct("cash_in_bank"), "2026-10-07")).net).toBe(P(75));
    const closed = await runAs(teller, () => closeSessionAction({ sessionId, counts: [] }));
    expect(closed).toMatchObject({ ok: true, data: { expected: "7500" } });
  });

  it("cancellation: not twice, not after the session closed, and the item list must use known types", async () => {
    const sessionId = await openSessionAs(teller);
    const a = await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    const b = await receiptAs(teller, [["CERT_FEE", "60.00"]], "BIR-2");
    if (!a.ok || !b.ok) throw new Error("receipts failed");
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: a.data.id, reason: "dup" }))).toEqual({ ok: true, data: undefined });
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: a.data.id, reason: "dup" }))).toMatchObject({ ok: false, error: expect.stringMatching(/already cancelled/) });
    await runAs(teller, () => closeSessionAction({ sessionId, counts: [] }));
    expect(await runAs(manager, () => cancelReceiptAction({ receiptId: b.data.id, reason: "late" }))).toMatchObject({ ok: false, error: expect.stringMatching(/session is already closed/) });
    expect(await receiptAs(teller, [["NO_SUCH", "10"]])).toMatchObject({ ok: false });
  });
});

describe("T4.5 DVs and bank deposits", () => {
  it("numbers DVs, needs approval before release, posts checks to Cash in Bank without a cash-out, and can cancel unreleased DVs", async () => {
    await openSessionAs(teller, "10,000.00");
    const cashDv = await dv("CASH", "500.00");
    expect(cashDv.dvNo).toBe("DV-2026-00001");
    expect(await runAs(teller, () => releaseDvAction({ dvId: cashDv.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't approved/) });

    const checkDv = await dv("CHECK", "1,200.00", "CHK-001");
    await runAs(manager, () => approveDvAction({ dvId: checkDv.id }));
    expect((await runAs(teller, () => releaseDvAction({ dvId: checkDv.id }))).ok).toBe(true);
    expect((await accountBalance(await acct("cash_in_bank"), "2026-10-07")).net).toBe(-P(1200));
    expect(await getDb().select().from(cashOuts)).toHaveLength(0);

    expect(await runAs(manager, () => cancelDvAction({ dvId: cashDv.id, reason: "Not needed" }))).toEqual({ ok: true, data: undefined });
    const [c] = await getDb().select().from(disbursementVouchers).where(eq(disbursementVouchers.id, cashDv.id));
    expect(c?.status).toBe("CANCELLED");
  });

  it("cash-outs can't exceed the cash in the drawer", async () => {
    await openSessionAs(teller, "1,000.00");
    const big = await dv("CASH", "1,500.00");
    await runAs(manager, () => approveDvAction({ dvId: big.id }));
    expect(await runAs(teller, () => releaseDvAction({ dvId: big.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough cash/) });
    expect(await runAs(teller, () => bankDepositAction({ amount: "1,000.01", bankReference: "DS-1" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Not enough cash/) });
    expect((await runAs(teller, () => bankDepositAction({ amount: "1,000.00", bankReference: "DS-1" }))).ok).toBe(true);
  });
});

describe("T4.7 cash position", () => {
  it("lists short/over postings as other movements and still reconciles to the GL", async () => {
    const sessionId = await openSessionAs(teller, "0");
    await receiptAs(teller, [["HALL_RENTAL", "1,000.00"]]);
    await runAs(teller, () => closeSessionAction({ sessionId, counts: [{ denomination: "500", qty: 1 }, { denomination: "200", qty: 2 }] }));
    await runAs(manager, () => verifySessionAction({ sessionId }));
    const [s] = await getDb().select().from(tellerSessions).where(eq(tellerSessions.id, sessionId));
    expect(s?.variance).toBe(-P(100));

    const pos = await cashPosition("2026-10-07");
    expect(pos.totalIn).toBe(P(1000));
    expect(pos.other.map((o) => o.amount)).toEqual([-P(100)]);
    expect(pos.ending).toBe(P(900));
    expect(pos.reconciled).toBe(true);
  });
});

describe("T4.7 cash position Excel export", () => {
  it("returns an .xlsx for permitted users and 403 for a teller", async () => {
    const { GET } = await import("@/app/api/reports/cash-position/route");
    await openSessionAs(teller, "0");
    await receiptAs(teller, [["CERT_FEE", "50.00"]]);
    const ok = await runAs(manager, () => GET(new Request("http://localhost:3000/api/reports/cash-position?date=2026-10-07")));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("spreadsheetml");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await ok.arrayBuffer()).buffer);
    const values: unknown[] = [];
    wb.worksheets[0]!.eachRow((r) => values.push((r.values as unknown[]).slice(1)));
    expect(values).toContainEqual(["Ending cash on hand", 50]);
    expect(values).toContainEqual(["Agrees with the general ledger"]);
    const denied = await runAs(teller, () => GET(new Request("http://localhost:3000/api/reports/cash-position")));
    expect(denied.status).toBe(403);
  });
});
