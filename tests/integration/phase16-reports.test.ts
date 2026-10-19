import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { addOfficerAction, addTrainingAction, endOfficerTermAction } from "@/modules/governance/actions";
import { listOfficers, listTrainings, officerTrainingHours } from "@/modules/governance/service";
import { format } from "@/lib/money";
import { getLoan } from "@/modules/loans/servicing";
import { caprData, caprWorkbook } from "@/modules/reports/cda";
import { runReportAction } from "@/modules/reports/actions";
import { reportWorkbook } from "@/modules/reports/export";
import { dashboardKpis, efficiencyPercent, loanCollectionEfficiency } from "@/modules/reports/kpis";
import { runReport } from "@/modules/reports/operational";
import { memberSoa } from "@/modules/reports/soa";
import { soaPdf } from "@/modules/reports/soa-pdf";
import { accountIdFor, postJournal, reverseJournal, trialBalance } from "@/modules/ledger/service";
import { placeTimeDeposit, productByCode } from "@/modules/savings/service";
import { cashFlows, changesInEquity, financialCondition, operations } from "@/modules/accounting/statements";
import type { CdaTemplate } from "@/modules/reports/cda-templates";
import { recentRuns, recordRun } from "@/modules/reports/service";
import { updateSetting } from "@/modules/settings/service";
import { makeUser } from "../helpers/phase01";
import { P, seedLedger } from "../helpers/phase03";
import { payLoan } from "../helpers/phase11";
import { membersFixture, on, performanceFixture, soaFixture } from "../helpers/phase16";

afterEach(() => setClock(null));

describe("T16.1 officers, committees and trainings", () => {
  it("the manager records officers and their terms; who serves on a date; an ended term", async () => {
    const { manager } = await membersFixture();
    const teller = (await makeUser("TELLER", "teller1")).id;
    const add = (o: Partial<Parameters<typeof addOfficerAction>[0]>, by = manager) =>
      runAs(by, () => addOfficerAction({ memberNo: "M-000001", position: "Chairperson", committee: "BOARD", termStart: "2026-03-01", termEnd: "2028-02-28", electedAtGa: "2026-02-28", ...o }));
    await expect(add({}, teller)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await add({ memberNo: "M-999999" })).toEqual({ ok: false, error: "No member with no. M-999999" });
    expect(await add({ committee: "FINANCE" })).toEqual({ ok: false, error: "Choose the board or committee" });
    expect(await add({ termEnd: "2026-01-01" })).toEqual({ ok: false, error: "The term ends on or after it starts" });
    expect(await add({ position: " " })).toEqual({ ok: false, error: "Enter the position" });
    const chair = await add({});
    if (!chair.ok) throw new Error(chair.error);
    expect((await add({ memberNo: "m-000004", position: "Chairperson", committee: "AUDIT", electedAtGa: null, termEnd: null })).ok).toBe(true);
    expect((await listOfficers("2026-06-30")).map((o) => [o.committee, o.position, o.memberNo])).toEqual([
      ["AUDIT", "Chairperson", "M-000004"],
      ["BOARD", "Chairperson", "M-000001"],
    ]);
    expect(await listOfficers("2026-02-01")).toEqual([]);
    expect(await runAs(manager, () => endOfficerTermAction({ officerId: chair.data.id, termEnd: "2026-01-01" }))).toEqual({ ok: false, error: "The term ends on or after it starts" });
    expect((await runAs(manager, () => endOfficerTermAction({ officerId: chair.data.id, termEnd: "2026-06-30" }))).ok).toBe(true);
    expect((await listOfficers("2026-07-01")).map((o) => o.memberNo)).toEqual(["M-000004"]);
  });

  it("a training with its attendees (member nos.); hours per member in a period", async () => {
    const { manager } = await membersFixture();
    const add = (o: Partial<Parameters<typeof addTrainingAction>[0]>) =>
      runAs(manager, () => addTrainingAction({ title: "Fundamentals of Cooperatives", provider: "CDA Region IV-A", heldOn: "2026-05-14", hours: "8", memberNos: "M-000001, M-000002\nM-000006", ...o }));
    expect(await add({ hours: "0" })).toEqual({ ok: false, error: "Enter the hours, more than 0 (up to 2 decimals)" });
    expect(await add({ memberNos: "" })).toEqual({ ok: false, error: "Enter at least one attendee's member no." });
    expect(await add({ memberNos: "M-000001, M-000077" })).toEqual({ ok: false, error: "No member with no. M-000077" });
    expect(await add({ heldOn: "2099-01-01" })).toEqual({ ok: false, error: "The training date can't be in the future" });
    expect((await add({})).ok).toBe(true);
    expect((await add({ title: "Credit Management", hours: "4.5", heldOn: "2026-08-20", memberNos: "M-000001" })).ok).toBe(true);
    const list = await listTrainings("2026-01-01", "2026-12-31");
    expect(list.map((t) => [t.title, t.hours, t.attendees.map((a) => a.memberNo)])).toEqual([
      ["Credit Management", "4.50", ["M-000001"]],
      ["Fundamentals of Cooperatives", "8.00", ["M-000001", "M-000002", "M-000006"]],
    ]);
    const hours = await officerTrainingHours("2026-01-01", "2026-12-31");
    expect([...hours.values()].map((h) => [h.hours, h.trainings]).sort()).toEqual([
      ["12.50", 2],
      ["8.00", 1],
      ["8.00", 1],
    ]);
  });
});

describe("T16.2 the CDA (CAPR) data and workbook", () => {
  const sheetRows = (ws: ExcelJS.Worksheet) => {
    const out: unknown[][] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
    return out;
  };

  it("the CAPR figures by key: membership by type and sex, capital, the statements, funds, officers", async () => {
    const { manager } = await membersFixture();
    await withTx((tx) => updateSetting(tx, "coop.cda_reg_no", "9520-04012345", manager));
    expect((await runAs(manager, () => addOfficerAction({ memberNo: "M-000001", position: "Chairperson", committee: "BOARD", termStart: "2026-01-01", termEnd: null, electedAtGa: null }))).ok).toBe(true);
    const data = await caprData(2026);
    const v = (key: string) => data.find((d) => d.key === key)?.value;
    expect([v("coop.cda_reg_no"), v("report.year"), v("report.period")]).toEqual(["9520-04012345", 2026, "Jan 01, 2026 to Dec 31, 2026"]);
    expect([v("members.regular.male"), v("members.regular.female"), v("members.associate.female"), v("members.total"), v("members.new")]).toEqual([3, 2, 1, 6, 6]);
    expect([v("capital.paid_up"), v("fs.total_assets"), v("fs.net_surplus"), v("funds.reserve")]).toEqual([0n, 0n, 0n, 0n]);
    expect(v("officers.count")).toBe(1);
    expect(data.filter((d) => d.section === "Revenue by business line").map((d) => d.key)).toEqual(["revenue.water", "revenue.credit", "revenue.consumer", "revenue.general"]);
  });

  it("without the CDA template: a cover, the data sheets and the Unmapped fields note; with one: its mapped cells filled and the rest listed", async () => {
    const { manager } = await membersFixture();
    await withTx((tx) => updateSetting(tx, "coop.cda_reg_no", "9520-04012345", manager));
    const plain = new ExcelJS.Workbook();
    await plain.xlsx.load((await caprWorkbook(2026)) as unknown as ArrayBuffer);
    expect(plain.worksheets.map((w) => w.name)).toEqual(["Cover", "CAPR data", "Officers and trainings", "Unmapped fields"]);
    expect(sheetRows(plain.getWorksheet("Unmapped fields")!)[1]).toEqual(["Cooperative Annual Progress Report (CAPR)", "", "", "(whole template)", "docs/cda-templates/capr.xlsx hasn't been provided yet; the data sheets below hold every figure the MIS can give"]);
    // A template with one sheet: two mapped cells and one field the MIS has no data for.
    const dir = mkdtempSync(path.join(tmpdir(), "cda-"));
    const t = new ExcelJS.Workbook();
    t.addWorksheet("Part I").getCell("A2").value = "CDA Reg. No.";
    await t.xlsx.writeFile(path.join(dir, "capr.xlsx"));
    const templates: CdaTemplate[] = [
      {
        key: "CAPR",
        title: "CAPR (test)",
        file: "capr.xlsx",
        fields: [
          { sheet: "Part I", cell: "B2", label: "CDA Reg. No.", source: "coop.cda_reg_no" },
          { sheet: "Part I", cell: "B3", label: "Total members", source: "members.total" },
          { sheet: "Part I", cell: "B4", label: "Members who are persons with disability", source: null },
        ],
      },
    ];
    const filled = new ExcelJS.Workbook();
    await filled.xlsx.load((await caprWorkbook(2026, undefined, { templates, dir })) as unknown as ArrayBuffer);
    expect(filled.worksheets.map((w) => w.name)).toEqual(["Part I", "Cover", "CAPR data", "Officers and trainings", "Unmapped fields"]);
    expect([filled.getWorksheet("Part I")!.getCell("B2").value, filled.getWorksheet("Part I")!.getCell("B3").value]).toEqual(["9520-04012345", 6]);
    expect(sheetRows(filled.getWorksheet("Unmapped fields")!).slice(1)).toEqual([["CAPR (test)", "Part I", "B4", "Members who are persons with disability", "No source in the MIS"]]);
  });

  it("each generation is recorded", async () => {
    const { manager } = await membersFixture();
    await recordRun(getDb(), { report: "CAPR", params: { year: 2026 }, userId: manager });
    expect((await recentRuns("CAPR")).map((r) => [r.params, r.username])).toEqual([[{ year: 2026 }, "mgr1"]]);
  });
});

describe("T16.3 the management dashboard", () => {
  it("balances from the GL agree with the member records; loans due this week; loan collection efficiency of the month", async () => {
    const f = await soaFixture();
    on("2026-11-01");
    const k = await dashboardKpis();
    expect([k.loanPortfolio, k.deposits, k.paidUp]).toEqual([P(10000), P(1500), P(2700)]);
    expect(k.reconciliation.map((r) => [r.label, r.difference])).toEqual([
      ["Loans receivable (loan schedules)", 0n],
      ["Deposits (savings passbooks and time deposits)", 0n],
      ["Paid-up share capital (share registry)", 0n],
    ]);
    const first = (await getLoan(f.loanId))!.schedule[0]!;
    const installment = first.principalDue + first.interestDue;
    expect(k.alerts.loansDueThisWeek).toEqual({ loans: 1, amount: installment });
    expect(k.loanEfficiency).toMatchObject({ month: "2026-11", due: installment, collected: 0n, percent: "0.00%" });
    expect(k.members).toMatchObject({ total: 2, newThisMonth: 0 });
    // Paid on its due date: the month is fully collected.
    on("2026-11-05");
    const paid = await payLoan(f.memberId, f.loanId, format(installment).replace("₱", ""));
    if (!paid.ok) throw new Error(paid.error);
    expect(await loanCollectionEfficiency("2026-11")).toMatchObject({ due: installment, collected: installment, percent: "100.00%" });
    expect(efficiencyPercent(0n, 0n)).toBeNull();
  });
});

describe("T16.4 operational reports and their Excel export", () => {
  it("delinquency: contacts shown to the manager, masked for the board; releases, collections and store sales agree with the books; the workbook", async () => {
    const f = await soaFixture();
    const board = (await makeUser("BOARD", "board1")).id;
    const teller = (await makeUser("TELLER", "teller16")).id;
    await expect(runAs(teller, () => runReportAction({ key: "delinquency", params: {} }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(board, () => runReportAction({ key: "no-such-report", params: {} }))).toEqual({ ok: false, error: "Choose a report" });
    expect(await runAs(board, () => runReportAction({ key: "loan-releases", params: { from: "2026-11-01", to: "2026-10-01" } }))).toEqual({ ok: false, error: "The period starts on or before it ends" });
    const releases = await runReport("loan-releases", { from: "2026-10-01", to: "2026-10-31" }, { canSeeSensitive: false });
    expect(releases.rows.map((r) => [r.loanNo, r.memberNo, r.principal])).toEqual([[f.loanNo, "M-000001", P(10000)]]);
    // Nov 5: the first installment is paid; Dec 15: nothing more is paid, the second (Dec 5) is past due.
    on("2026-11-05");
    const first = (await getLoan(f.loanId))!.schedule[0]!;
    const paid = await payLoan(f.memberId, f.loanId, format(first.principalDue + first.interestDue).replace("₱", ""));
    if (!paid.ok) throw new Error(paid.error);
    on("2026-12-15");
    const collections = await runReport("loan-collections", { from: "2026-11-01", to: "2026-11-30" }, { canSeeSensitive: false });
    expect(collections.rows).toHaveLength(1);
    expect(collections.totals).toMatchObject({ interest: first.interestDue, principal: first.principalDue });
    expect(collections.reconciliation.map((r) => r.difference)).toEqual([0n]);
    const manager = await runAs(f.manager, () => runReportAction({ key: "delinquency", params: { asOf: "2026-12-15" } }));
    if (!manager.ok) throw new Error(manager.error);
    expect(manager.data.rows.map((r) => [r.memberNo, r.mobile, r.daysPastDue])).toEqual([["M-000001", "09171234567", 10]]);
    expect(manager.data.reconciliation.map((r) => [r.difference, r.agrees])).toEqual([["₱0.00", true]]);
    const masked = await runAs(board, () => runReportAction({ key: "delinquency", params: { asOf: "2026-12-15" } }));
    if (!masked.ok) throw new Error(masked.error);
    expect(masked.data.rows[0]?.mobile).toBe("•••••••4567");
    expect(String(masked.data.rows[0]?.comakers)).not.toContain("0917");
    const store = await runReport("store-sales", { from: "2026-10-01", to: "2026-10-31" }, { canSeeSensitive: false });
    expect(store.totals).toMatchObject({ net: P(350) });
    expect(store.reconciliation.map((r) => [r.gl, r.difference])).toEqual([[P(350), 0n]]);
    // The Excel export carries the rows, the totals and the reconciliation.
    const wb = new ExcelJS.Workbook();
    const result = await runReport("delinquency", { asOf: "2026-12-15" }, { canSeeSensitive: false });
    await wb.xlsx.load((await reportWorkbook(result, "PCMPC", "As of Dec 15, 2026")) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const values: unknown[][] = [];
    ws.eachRow((r) => values.push((r.values as unknown[]).slice(1)));
    expect(values[1]).toEqual(["Delinquency"]);
    // (eachRow skips the blank row under the subtitle.)
    expect(values[3]?.slice(0, 4)).toEqual(["Loan no.", "Member no.", "Borrower", "Mobile"]);
    expect(values[4]?.slice(1, 5)).toEqual(["M-000001", masked.data.rows[0]?.name, "•••••••4567", 10]);
    expect(values.at(-1)?.[0]).toBe("Loans receivable: whole portfolio (GL)");
  });
});

describe("T16.5 the member statement of account", () => {
  it("loans with arrears, the PDF; an entry posted to the member's savings without a passbook entry shows as a difference", async () => {
    const f = await soaFixture();
    const soa = await memberSoa(f.memberId);
    expect(soa.loans).toEqual([expect.objectContaining({ loanNo: f.loanNo, product: "Regular Loan", outstandingPrincipal: P(10000), arrears: 0n, daysPastDue: 0 })]);
    expect(soa.savings).toEqual([expect.objectContaining({ product: "Regular Savings", balance: P(1500) })]);
    const pdf = await soaPdf(soa, "PCMPC");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Dec 15: the first two installments are past due.
    on("2026-12-15");
    const late = (await memberSoa(f.memberId)).loans[0]!;
    expect(late.daysPastDue).toBe(40);
    expect(late.arrears > 0n).toBe(true);
    const [cash, savings] = [await accountIdFor("cash_on_hand"), await accountIdFor("savings_deposits")];
    await withTx((tx) => postJournal(tx, { date: "2026-12-15", book: "GJ", particulars: "Manual entry", lines: [{ accountId: cash, debit: P(100) }, { accountId: savings, credit: P(100), memberId: f.memberId }] }, f.book));
    expect((await memberSoa(f.memberId)).reconciliation.find((r) => r.label === "Savings deposits")).toEqual({ label: "Savings deposits", gl: P(1600), subsidiary: P(1500), difference: P(100) });
  });
});

describe("T16.6 the performance fixture: 1,000 members, 50,000 journal lines", () => {
  it("the trial balance, the four statements, the dashboard and the CAPR data each answer in under 5 s", async () => {
    await performanceFixture();
    const timed = async <T>(label: string, fn: () => Promise<T>) => {
      const started = performance.now();
      const value = await fn();
      const ms = performance.now() - started;
      expect(ms, `${label} took ${Math.round(ms)} ms`).toBeLessThan(5000);
      return value;
    };
    const tb = await timed("trial balance", () => trialBalance("2026-12-31"));
    expect(tb.balanced).toBe(true);
    const sfc = await timed("financial condition", () => financialCondition("2026-12-31"));
    expect(sfc.totals.balanced).toBe(true);
    await timed("operations", () => operations("2026-01-01", "2026-12-31"));
    await timed("changes in equity", () => changesInEquity("2026-01-01", "2026-12-31"));
    await timed("cash flows", () => cashFlows("2026-01-01", "2026-12-31"));
    const k = await timed("dashboard", () => dashboardKpis());
    expect(k.members.total).toBe(1000);
    const capr = await timed("CAPR data", () => caprData(2026));
    expect(capr.find((f) => f.key === "members.total")?.value).toBe(1000);
  }, 180_000);
});

describe("Phase 16 review follow-ups", () => {
  it("a time deposit counts once in the deposits reconciliation; TD maturities show the rate as a percentage; an overdue TD stays on the alert", async () => {
    const f = await soaFixture();
    const td = await productByCode("TD");
    if (!td) throw new Error("TD not seeded");
    await withTx((tx) => placeTimeDeposit(tx, { memberId: f.memberId, productId: td.id, fromAccountId: f.savingsAccountId, principal: P(1000), termDays: 90 }, f.manager));
    const k = await dashboardKpis();
    expect(k.deposits).toBe(P(1500));
    expect(k.reconciliation.every((r) => r.difference === 0n)).toBe(true);
    const view = await runAs(f.manager, () => runReportAction({ key: "td-maturities", params: { from: "2026-10-01", to: "2027-12-31" } }));
    if (!view.ok) throw new Error(view.error);
    expect(view.data.rows).toHaveLength(1);
    expect(view.data.rows[0]).toMatchObject({ memberNo: "M-000001", principal: "₱1,000.00" });
    expect(String(view.data.rows[0]?.ratePa)).toMatch(/^\d+\.\d{2}%$/);
    // Matured Jan 3, 2027 and not yet processed: still on the alert on Jan 5.
    on("2027-01-05");
    expect((await dashboardKpis()).alerts.maturingTimeDeposits.map((t) => t.memberNo)).toEqual(["M-000001"]);
  });

  it("the auditor and the board see masked contacts; a past date without that day's aging shows no reconciliation", async () => {
    await soaFixture();
    on("2026-12-15");
    const auditor = (await makeUser("AUDITOR", "auditor1")).id;
    const r = await runAs(auditor, () => runReportAction({ key: "delinquency", params: { asOf: "2026-12-15" } }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.rows[0]?.mobile).toBe("•••••••4567");
    const past = await runReport("delinquency", { asOf: "2026-12-01" }, { canSeeSensitive: false });
    expect([past.rows, past.reconciliation]).toEqual([[], []]);
  });

  it("CAPR: the CETF remitted and the CDF used in the year count the entries that stand (a reversed one doesn't)", async () => {
    await seedLedger();
    const book = (await makeUser("BOOKKEEPER", "book16")).id;
    const [cash, cdf, cetf] = [await accountIdFor("cash_on_hand"), await accountIdFor("community_development_fund"), await accountIdFor("cetf_payable")];
    const post = (date: string, account: string, amount: bigint) => withTx((tx) => postJournal(tx, { date, book: "GJ", particulars: "Fund use", lines: [{ accountId: account, debit: amount }, { accountId: cash, credit: amount }] }, book));
    await post("2026-06-01", cdf, P(500));
    const wrong = await post("2026-06-02", cdf, P(200));
    await withTx((tx) => reverseJournal(tx, wrong.id, "2026-06-03", "Wrong fund", book));
    await post("2026-07-01", cetf, P(300));
    const data = await caprData(2026);
    const v = (key: string) => data.find((d) => d.key === key)?.value;
    expect([v("funds.cdf_utilized"), v("funds.cetf_remitted")]).toEqual([P(500), P(300)]);
    expect(v("report.period")).toBe("Jan 01, 2026 to Dec 31, 2026");
  });

  it("an officer can't hold the same position twice in one term; a training needs its date", async () => {
    const { manager } = await membersFixture();
    const add = (termStart: string) => runAs(manager, () => addOfficerAction({ memberNo: "M-000001", position: "Chairperson", committee: "BOARD", termStart, termEnd: null, electedAtGa: null }));
    expect((await add("2026-01-01")).ok).toBe(true);
    expect(await add("2026-03-01")).toEqual({ ok: false, error: "M-000001 already holds that position for part of that term" });
    expect(await runAs(manager, () => addTrainingAction({ title: "T", provider: "P", heldOn: "", hours: "8", memberNos: "M-000001" }))).toEqual({ ok: false, error: "Enter the training date" });
  });
});
