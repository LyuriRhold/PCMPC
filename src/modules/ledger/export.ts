import ExcelJS from "exceljs";
import { formatDate, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { generalLedger, trialBalance } from "./service";

/**
 * Excel exports (exceljs). Amounts are written as numbers of pesos with 2 decimals for the
 * bookkeeper's spreadsheet; the conversion is exact for any amount below ₱90 trillion.
 */
const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

function title(ws: ExcelJS.Worksheet, coop: string, heading: string, sub: string) {
  ws.addRow([coop]).font = { bold: true, size: 12 };
  ws.addRow([heading]).font = { bold: true };
  ws.addRow([sub]);
  ws.addRow([]);
}

export async function trialBalanceWorkbook(asOf: BusinessDate, coop: string): Promise<Buffer> {
  const tb = await trialBalance(asOf);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet("Trial Balance");
  title(ws, coop, "Trial Balance", `As of ${formatDate(asOf)}`);
  const head = ws.addRow(["Code", "Account", "Debit", "Credit"]);
  head.font = { bold: true };
  for (const r of tb.rows) ws.addRow([r.code, r.name + (r.provisional ? " (provisional)" : ""), r.debit ? pesos(r.debit) : null, r.credit ? pesos(r.credit) : null]);
  const total = ws.addRow(["", "TOTAL", pesos(tb.totalDebit), pesos(tb.totalCredit)]);
  total.font = { bold: true };
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 44;
  for (const c of [3, 4]) {
    ws.getColumn(c).width = 18;
    ws.getColumn(c).numFmt = PESO;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generalLedgerWorkbook(accountId: string, from: BusinessDate, to: BusinessDate, coop: string): Promise<Buffer> {
  const gl = await generalLedger(accountId, from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet("General Ledger");
  title(ws, coop, `General Ledger: ${gl.account.code} ${gl.account.name}`, `${formatDate(from)} to ${formatDate(to)} · normal balance ${gl.side}`);
  ws.addRow(["Date", "JE no.", "Particulars", "Member", "Debit", "Credit", "Balance"]).font = { bold: true };
  ws.addRow(["", "", "Opening balance", "", null, null, pesos(gl.opening)]);
  for (const l of gl.lines) {
    ws.addRow([formatDate(l.date), l.jeNo, l.particulars, l.memberNo ?? "", l.debit ? pesos(l.debit) : null, l.credit ? pesos(l.credit) : null, pesos(l.running)]);
  }
  ws.addRow(["", "", "Closing balance", "", null, null, pesos(gl.closing)]).font = { bold: true };
  const widths = [14, 16, 44, 12, 16, 16, 18];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of [5, 6, 7]) ws.getColumn(c).numFmt = PESO;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
