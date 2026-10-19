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
import { dashboardKpis, efficiencyPercent, loanCollectionEfficiency } from "@/modules/reports/kpis";
import type { CdaTemplate } from "@/modules/reports/cda-templates";
import { recentRuns, recordRun } from "@/modules/reports/service";
import { updateSetting } from "@/modules/settings/service";
import { makeUser } from "../helpers/phase01";
import { P } from "../helpers/phase03";
import { payLoan } from "../helpers/phase11";
import { membersFixture, on, soaFixture } from "../helpers/phase16";

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
