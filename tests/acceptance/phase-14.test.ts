import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { auditLog } from "@/modules/audit/schema";
import { accounts } from "@/modules/ledger/schema";
import { createAccountAction } from "@/modules/ledger/actions";
import { accountBalance, accountIdFor, postJournal, trialBalance } from "@/modules/ledger/service";
import { closeMonthAction, reopenMonthAction, runDepreciationAction, registerAssetAction, yearEndCloseAction } from "@/modules/accounting/actions";
import { monthChecklist } from "@/modules/accounting/close";
import { fsPdf, fsWorkbook } from "@/modules/accounting/export";
import { financialCondition, operations, cashFlows, type Statement } from "@/modules/accounting/statements";
import { depreciationOf } from "@/modules/accounting/assets";
import { P } from "../helpers/phase03";
import { openSessionAs } from "../helpers/phase04";
import { fsPeople, on, postFixture, runJobsThrough, setupFs } from "../helpers/phase14";

afterEach(() => setClock(null));

const line = (s: Statement, code: string) => s.lines.find((l) => l.code === code)?.amount;

/** Closes January to November 2026 (no activity: nothing on their checklists). */
async function closeJanToNov() {
  for (let month = 1; month <= 11; month++) {
    const r = await runAs(fsPeople().bookkeeper, () => closeMonthAction({ year: 2026, month }));
    if (!r.ok) throw new Error(`2026-${month}: ${r.error}`);
  }
}

describe("Phase 14 acceptance (golden fixture: FY 2026, all via postJournal)", () => {
  beforeEach(async () => {
    await setupFs();
    await postFixture();
  });

  it("A14.1 Statement of Operations → revenues ₱90,400.00; expenses ₱71,000.00; net surplus ₱19,400.00", async () => {
    const soo = await operations("2026-01-01", "2026-12-31");
    expect(line(soo, "INTEREST_LOANS")).toBe(P(18000));
    expect(line(soo, "CREDIT_FEES")).toBe(P(2400));
    expect(line(soo, "SALES")).toBe(P(70000));
    expect(soo.totals).toMatchObject({ revenues: P(90400), expenses: P(71000), netSurplus: P(19400) });
  });

  it("A14.2 Statement of Financial Condition → total assets ₱170,400.00 = liabilities and equity ₱170,400.00", async () => {
    const sfc = await financialCondition("2026-12-31");
    expect(line(sfc, "CASH")).toBe(P(82400));
    expect(line(sfc, "LOANS")).toBe(P(80000));
    expect(line(sfc, "INVENTORIES")).toBe(P(8000));
    expect(line(sfc, "DEPOSITS")).toBe(P(51000));
    expect(line(sfc, "SHARE_CAPITAL")).toBe(P(100000));
    expect(line(sfc, "NET_SURPLUS")).toBe(P(19400));
    expect(sfc.totals).toMatchObject({ assets: P(170400), liabilitiesAndEquity: P(170400) });
  });

  it("A14.3 cash flow statement → ending cash ₱82,400.00 = GL cash", async () => {
    const cf = await cashFlows("2026-01-01", "2026-12-31");
    const cash = (await accountBalance(await accountIdFor("cash_on_hand"), "2026-12-31")).net + (await accountBalance(await accountIdFor("cash_in_bank"), "2026-12-31")).net;
    expect(cf.totals.endingCash).toBe(P(82400));
    expect(cf.totals.endingCash).toBe(cash);
  });

  it("A14.4 closing a month with an OPEN teller session is blocked; the checklist shows the failing item", async () => {
    await openSessionAs(fsPeople().teller);
    on("2027-01-05");
    await runJobsThrough("2026-12-15", "2026-12-31");
    const r = await runAs(fsPeople().bookkeeper, () => closeMonthAction({ year: 2026, month: 12 }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/teller sessions/i) });
    const items = await monthChecklist(2026, 12);
    expect(items.find((i) => i.key === "teller_sessions")).toMatchObject({ ok: false });
    expect(items.filter((i) => !i.ok).map((i) => i.key)).toEqual(["teller_sessions"]);
  });

  it("A14.5 posting into a closed month is rejected; reopening as BOOKKEEPER → Forbidden; as ADMIN with a reason → allowed and audited", async () => {
    on("2027-01-05");
    await runJobsThrough("2026-12-15", "2026-12-31");
    const closed = await runAs(fsPeople().bookkeeper, () => closeMonthAction({ year: 2026, month: 12 }));
    if (!closed.ok) throw new Error(closed.error);
    const cash = await accountIdFor("cash_on_hand");
    const fees = await accountIdFor("service_fee_income");
    const late = () => withTx((tx) => postJournal(tx, { date: "2026-12-31", book: "GJ", particulars: "Late fee", lines: [{ accountId: cash, debit: P(10) }, { accountId: fees, credit: P(10) }] }, fsPeople().bookkeeper));
    await expect(late()).rejects.toThrow(/2026-12 is closed/);
    await expect(runAs(fsPeople().bookkeeper, () => reopenMonthAction({ year: 2026, month: 12, reason: "Late fee" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(fsPeople().admin, () => reopenMonthAction({ year: 2026, month: 12, reason: " " }))).toMatchObject({ ok: false });
    expect((await runAs(fsPeople().admin, () => reopenMonthAction({ year: 2026, month: 12, reason: "Late service fee from the branch" }))).ok).toBe(true);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, "gl.period_reopen"), eq(auditLog.userId, fsPeople().admin)));
    expect(audit?.after).toMatchObject({ period: "2026-12", reason: "Late service fee from the branch" });
    await late();
  });

  it("A14.6 year-end close → revenues and expenses 0; Undivided Net Surplus ₱19,400.00 Cr; FY 2027 opening TB = 2026 closing balance sheet", async () => {
    on("2027-01-05");
    await runJobsThrough("2026-12-15", "2026-12-31");
    await closeJanToNov();
    const r = await runAs(fsPeople().bookkeeper, () => yearEndCloseAction({ year: 2026 }));
    if (!r.ok) throw new Error(r.error);
    const tb = await trialBalance("2026-12-31");
    expect(tb.rows.filter((row) => row.type === "REVENUE" || row.type === "EXPENSE")).toEqual([]);
    const uns = tb.rows.find((row) => row.name === "Undivided Net Surplus");
    expect(uns).toMatchObject({ debit: 0n, credit: P(19400) });
    const opening2027 = await trialBalance("2027-01-01");
    expect(opening2027.rows).toEqual(tb.rows);
    const sfc2026 = await financialCondition("2026-12-31");
    const sfc2027 = await financialCondition("2027-01-01");
    expect(sfc2027.totals).toEqual(sfc2026.totals);
    expect(line(sfc2026, "UNS")).toBe(P(19400));
    expect(line(sfc2026, "NET_SURPLUS")).toBe(0n);
    // The year's Statement of Operations still shows the year (the closing entry isn't an operation).
    expect((await operations("2026-01-01", "2026-12-31")).totals.netSurplus).toBe(P(19400));
  });

  it("A14.7 equipment ₱36,000.00 over 36 months, no salvage → ₱1,000.00 a month; the same period twice → rejected", async () => {
    const { bookkeeper } = fsPeople();
    const a = await runAs(bookkeeper, () => registerAssetAction({ tag: "EQ-001", description: "Desktop computer", classCode: "OFFICE_EQUIPMENT", acquisitionDate: "2026-12-01", cost: "36,000.00", salvage: "0.00", lifeMonths: 36 }));
    if (!a.ok) throw new Error(a.error);
    const run = await runAs(bookkeeper, () => runDepreciationAction({ period: "2026-12" }));
    if (!run.ok) throw new Error(run.error);
    expect(run.data.total).toBe("₱1,000.00");
    expect(await depreciationOf(a.data.id, "2026-12")).toBe(P(1000));
    expect(await runAs(bookkeeper, () => runDepreciationAction({ period: "2026-12" }))).toMatchObject({ ok: false, error: expect.stringMatching(/2026-12 .*already/) });
  });

  it("A14.8 an unmapped postable account → FS generation fails with the list of unmapped accounts", async () => {
    const [parent] = await getDb().select().from(accounts).where(eq(accounts.code, "53000"));
    const created = await runAs(fsPeople().bookkeeper, () => createAccountAction({ code: "53990", name: "Unmapped Test Expense", type: "EXPENSE", normalBalance: "DR", parentId: parent!.id, isPostable: true, scaCode: null }));
    if (!created.ok) throw new Error(created.error);
    await expect(operations("2026-01-01", "2026-12-31")).rejects.toThrow(/53990 Unmapped Test Expense/);
    await expect(financialCondition("2026-12-31")).rejects.toThrow(/not mapped/i);
  });

  it("A14.9 the FS export to .xlsx and .pdf opens and its totals equal A14.1/A14.2", async () => {
    const xlsx = await fsWorkbook({ from: "2026-01-01", to: "2026-12-31" }, "PCMPC");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    const values = (name: string) => {
      const ws = wb.getWorksheet(name);
      const out: Record<string, unknown> = {};
      ws?.eachRow((row) => {
        const label = row.getCell(1).value;
        if (typeof label === "string") out[label] = row.getCell(2).value;
      });
      return out;
    };
    expect(values("Financial Condition")).toMatchObject({ "Total assets": 170400, "Total liabilities and equity": 170400 });
    expect(values("Operations")).toMatchObject({ "Total revenues": 90400, "Total expenses": 71000, "Net surplus": 19400 });
    const pdf = await fsPdf({ from: "2026-01-01", to: "2026-12-31" }, "PCMPC");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
