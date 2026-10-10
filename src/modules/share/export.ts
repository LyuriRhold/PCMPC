import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { formatDate, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { members } from "@/modules/members/schema";
import { memberShareLedger } from "./service";
import { TXN_LABEL } from "./labels";

/** Member share ledger as .xlsx (PHASE-08 T8.5). Amounts are pesos with 2 decimals, as in the GL exports. */
const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

/** Null when the member doesn't exist. */
export async function shareLedgerWorkbook(memberId: string, range: { from?: BusinessDate; to?: BusinessDate }, coop: string): Promise<{ body: Buffer; memberNo: string } | null> {
  const [m] = await getDb().select().from(members).where(eq(members.id, memberId));
  if (!m) return null;
  const ledger = await memberShareLedger(memberId, range);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet("Share Ledger");
  ws.addRow([coop]).font = { bold: true, size: 12 };
  ws.addRow([`Member Share Ledger: ${m.memberNo ?? ""} ${m.lastName}, ${m.firstName}`]).font = { bold: true };
  const period = range.from && range.to ? `${formatDate(range.from)} to ${formatDate(range.to)}` : range.from ? `From ${formatDate(range.from)}` : range.to ? `Up to ${formatDate(range.to)}` : "All transactions";
  ws.addRow([period]);
  ws.addRow([]);
  ws.addRow(["Date", "Transaction", "Reference", "Remarks", "Subscribed", "Paid-up", "Subscribed balance", "Paid-up balance"]).font = { bold: true };
  ws.addRow(["", "Opening balance", "", "", null, null, pesos(ledger.opening.subscribed), pesos(ledger.opening.paidUp)]);
  for (const r of ledger.rows) {
    ws.addRow([formatDate(r.date), TXN_LABEL[r.type], r.refNo ?? r.jeNo ?? "", r.remarks ?? "", r.subscribed ? pesos(r.subscribed) : null, r.paidUp ? pesos(r.paidUp) : null, pesos(r.subscribedBalance), pesos(r.paidUpBalance)]);
  }
  ws.addRow(["", "Closing balance", "", "", null, null, pesos(ledger.closing.subscribed), pesos(ledger.closing.paidUp)]).font = { bold: true };
  [14, 30, 18, 36, 16, 16, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of [5, 6, 7, 8]) ws.getColumn(c).numFmt = PESO;
  return { body: Buffer.from(await wb.xlsx.writeBuffer()), memberNo: m.memberNo ?? m.id };
}
