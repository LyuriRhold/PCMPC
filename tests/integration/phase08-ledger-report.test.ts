import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { GET as ledgerRoute } from "@/app/api/share/ledger/route";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { trialBalance } from "@/modules/ledger/service";
import { approveWithdrawalAction, transferAction, withdrawSharesAction } from "@/modules/share/actions";
import { shareLedgerWorkbook } from "@/modules/share/export";
import { memberShareLedger, shareRegistry, shareTotals } from "@/modules/share/service";
import { makeUser } from "../helpers/phase01";
import { acct, P } from "../helpers/phase03";
import { at, member, pay, receipt, setupShares, subscribe, tellerToday } from "../helpers/phase08";

let manager = "";
beforeEach(async () => {
  manager = (await setupShares()).manager.id;
});
afterEach(() => setClock(null));

async function rows(buf: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer);
  const out: unknown[][] = [];
  wb.worksheets[0]?.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
  return out;
}

/** A member who subscribed on Mar 02, paid ₱1,000 on Mar 10 and ₱1,500 on Jun 15. */
async function history() {
  setClock(() => at("2026-03-02"));
  const m = await member("Ledger");
  await subscribe(m, 100);
  setClock(() => at("2026-03-10"));
  expect((await pay(m, "1,000.00")).ok).toBe(true);
  setClock(() => at("2026-06-15"));
  expect((await pay(m, "1,500.00")).ok).toBe(true);
  setClock(null);
  return m;
}

describe("T8.5 member share ledger report", () => {
  it("a date range carries the earlier movements as the opening balance", async () => {
    const m = await history();
    const ledger = await memberShareLedger(m, { from: "2026-04-01", to: "2026-12-31" });
    expect(ledger.opening).toEqual({ subscribed: P(10000), paidUp: P(1000) });
    expect(ledger.rows.map((r) => [r.date, r.type, r.paidUp, r.paidUpBalance])).toEqual([["2026-06-15", "PAYMENT", P(1500), P(2500)]]);
    expect(ledger.closing).toEqual({ subscribed: P(10000), paidUp: P(2500) });
  });

  it("the Excel export has the opening, each movement with running balances, and the closing", async () => {
    const m = await history();
    const wb = await shareLedgerWorkbook(m, { from: "2026-03-05" }, "PCMPC");
    if (!wb) throw new Error("no workbook");
    const r = await rows(wb.body);
    expect(r[1]?.[0]).toMatch(/^Member Share Ledger: M-\d{6} Ledger, Juan/);
    expect(r[2]).toEqual(["From Mar 05, 2026"]);
    expect(r[4]).toEqual(["", "Opening balance", "", "", undefined, undefined, 10000, 0]);
    expect(r[5]?.slice(0, 2)).toEqual(["Mar 10, 2026", "Payment"]);
    expect(r[5]?.slice(4)).toEqual([undefined, 1000, 10000, 1000]);
    expect(r[6]?.slice(4)).toEqual([undefined, 1500, 10000, 2500]);
    expect(r.at(-1)).toEqual(["", "Closing balance", "", "", undefined, undefined, 10000, 2500]);
  });

  it("the export route needs share.read and a valid member and dates", async () => {
    const m = await history();
    const clerk = await makeUser("BILLING_CLERK", "noshare");
    const url = (q: string) => new Request(`http://localhost/api/share/ledger?${q}`);
    expect((await runAs(clerk.id, () => ledgerRoute(url(`member=${m}`)))).status).toBe(403);
    expect((await runAs(manager, () => ledgerRoute(url(`member=${m}&from=2026-13-01`)))).status).toBe(400);
    expect((await runAs(manager, () => ledgerRoute(url(`member=${m}&from=2026-12-01&to=2026-01-01`)))).status).toBe(400);
    expect((await runAs(manager, () => ledgerRoute(url("member=00000000-0000-4000-8000-000000000000")))).status).toBe(404);
    const ok = await runAs(manager, () => ledgerRoute(url(`member=${m}&from=&to=2026-12-31`)));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/share-ledger-M-\d{6}\.xlsx/);
    expect((await rows(await ok.arrayBuffer())).at(-1)?.slice(6)).toEqual([10000, 2500]);
  });
});

describe("Exit check: TB balances after the fixture", () => {
  it("subscribe, pay, fee, transfer and withdraw keep the trial balance balanced and the GL equal to the share ledger", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await subscribe(a, 100);
    await subscribe(b, 100);
    expect((await receipt(a, [{ type: "SHARE_PAYMENT", amount: "2,500.00" }, { type: "MEMBERSHIP_FEE", amount: "500.00" }])).ok).toBe(true);
    expect((await pay(b, "2,000.00")).ok).toBe(true);
    expect((await runAs(manager, () => transferAction({ fromMemberId: a, toMemberId: b, amount: "500.00", bodRef: "BOD 9" }))).ok).toBe(true);
    expect((await runAs(manager, () => approveWithdrawalAction({ memberId: a, reason: "Resignation", bodRef: "BOD 10" }))).ok).toBe(true);
    const w = await runAs(await tellerToday(), () => withdrawSharesAction({ memberId: a }));
    if (!w.ok) throw new Error(w.error);

    const tb = await trialBalance("2026-12-31");
    expect(tb.totalDebit).toBe(tb.totalCredit);
    const [cap, rec] = await Promise.all([acct("subscribed_share_capital_common"), acct("subscription_receivable_common")]);
    const net = (accountId: string) => {
      const row = tb.rows.find((r) => r.accountId === accountId);
      return (row?.credit ?? 0n) - (row?.debit ?? 0n);
    };
    // GL paid-up (capital − receivable) = the share ledgers' paid-up total: A 0, B 2,000 + 500 transferred in.
    // Subscribed: B's 100 shares + the ₱500.00 of fully paid capital transferred in.
    expect(net(cap) + net(rec)).toBe(P(2500));
    expect(await shareTotals()).toMatchObject({ paidUp: P(2500), subscribed: P(10500) });
  });
});

describe("T8.4 share registry", () => {
  it("lists only members with share records, with coop totals", async () => {
    const a = await member("Alpha");
    const b = await member("Bravo");
    await member("Charlie");
    await subscribe(a, 100);
    await subscribe(b, 120);
    expect((await pay(a, "2,500.00")).ok).toBe(true);
    const list = await shareRegistry({});
    expect(list.total).toBe(2);
    expect(list.rows.map((r) => [r.lastName, r.paidUp])).toEqual([
      ["Alpha", P(2500)],
      ["Bravo", 0n],
    ]);
    expect((await shareRegistry({ q: "brav" })).rows.map((r) => r.lastName)).toEqual(["Bravo"]);
    expect(await shareTotals()).toEqual({ subscribed: P(22000), paidUp: P(2500), unpaid: P(19500), holders: 1 });
  });
});
