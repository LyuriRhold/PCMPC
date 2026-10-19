import ExcelJS from "exceljs";
import { formatDate, isBusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import type { Cell, ReportResult } from "./operational";

/**
 * Excel export of an operational report (PHASE-16 T16.4): the same rows, totals and reconciliation
 * as the screen. Amounts are numbers of pesos with 2 decimals, as in the other exports.
 */

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

const cellValue = (v: Cell | undefined, kind: string): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return pesos(v);
  if (kind === "date" && typeof v === "string" && isBusinessDate(v)) return formatDate(v);
  return v;
};

export async function reportWorkbook(result: ReportResult, coop: string, subtitle: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet(result.title.slice(0, 31));
  ws.addRow([coop]).font = { bold: true, size: 12 };
  ws.addRow([result.title]).font = { bold: true };
  ws.addRow([subtitle]);
  ws.addRow([]);
  ws.addRow(result.columns.map((c) => c.label)).font = { bold: true };
  result.columns.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.width = c.kind === "money" ? 16 : c.key === "name" || c.key === "product" || c.key === "comakers" ? 32 : 14;
    if (c.kind === "money") column.numFmt = PESO;
  });
  for (const row of result.rows) ws.addRow(result.columns.map((c) => cellValue(row[c.key], c.kind)));
  if (result.totals) {
    const totals = result.totals;
    ws.addRow(result.columns.map((c, i) => (i === 0 && totals[c.key] === undefined ? "Total" : cellValue(totals[c.key], c.kind)))).font = { bold: true };
  }
  if (result.reconciliation.length) {
    ws.addRow([]);
    ws.addRow(["Reconciliation with the books", "GL", "This report", "Difference"]).font = { bold: true };
    for (const r of result.reconciliation) {
      const row = ws.addRow([r.label, pesos(r.gl), pesos(r.subsidiary), pesos(r.difference)]);
      for (const i of [2, 3, 4]) row.getCell(i).numFmt = PESO;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
