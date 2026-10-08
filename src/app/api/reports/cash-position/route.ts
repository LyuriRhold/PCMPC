import ExcelJS from "exceljs";
import { ForbiddenError, getCurrentUser, requirePermission, UnauthenticatedError } from "@/lib/auth-guard";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import "@/modules/plugins";
import { cashPosition } from "@/modules/cashiering/cash-position";
import { getSetting } from "@/modules/settings/service";

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

/** Peso number for a spreadsheet cell (see Decisions: Excel cells hold numbers). */
function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const v = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -v : v;
}

/** GET /api/reports/cash-position?date=YYYY-MM-DD → .xlsx (cash.verify or gl.read). */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    await requirePermission(user?.permissions.has("cash.verify") ? "cash.verify" : "gl.read");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return new Response("Sign in first", { status: 401 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  const param = new URL(request.url).searchParams.get("date");
  const date = param && isBusinessDate(param) ? param : businessToday();
  const p = await cashPosition(date);

  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet("Cash Position");
  ws.addRow([await getSetting("coop.name")]).font = { bold: true, size: 12 };
  ws.addRow(["Daily Cash Position (Cash on Hand)"]).font = { bold: true };
  ws.addRow([formatDate(date)]);
  ws.addRow([]);
  ws.addRow(["Beginning cash on hand", pesos(p.beginning)]).font = { bold: true };
  ws.addRow(["Add: receipts"]);
  for (const r of p.receipts) ws.addRow([`   ${r.label} (${r.count})`, pesos(r.amount)]);
  ws.addRow(["Total receipts", pesos(p.totalIn)]).font = { bold: true };
  ws.addRow(["Less: cash-outs"]);
  for (const o of p.cashOuts) ws.addRow([`   ${o.label} (${o.count})`, -pesos(o.amount)]);
  ws.addRow(["Total cash-outs", -pesos(p.totalOut)]).font = { bold: true };
  if (p.other.length) {
    ws.addRow(["Other postings to Cash on Hand"]);
    for (const o of p.other) ws.addRow([`   ${o.jeNo ?? ""} ${o.particulars}`, pesos(o.amount)]);
  }
  ws.addRow(["Ending cash on hand", pesos(p.ending)]).font = { bold: true };
  ws.addRow(["GL Cash on Hand balance", pesos(p.gl)]);
  ws.addRow([p.reconciled ? "Agrees with the general ledger" : "DOES NOT agree with the general ledger"]);
  ws.getColumn(1).width = 50;
  ws.getColumn(2).width = 20;
  ws.getColumn(2).numFmt = PESO;
  const body = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="cash-position-${date}.xlsx"`,
    },
  });
}
