import ExcelJS from "exceljs";
import type { Money } from "@/lib/money";
import { ratePercent, SurplusError } from "./engine";
import { allocationLines, getAllocation } from "./service";

/**
 * The allocation workbook (PHASE-15 T15.6): the allocation summary and the per-member ISC and PR list
 * for the General Assembly. Amounts are numbers of pesos with 2 decimals for the spreadsheet, as in
 * the other exports.
 */

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

const STATUS: Record<string, string> = { DRAFT: "Draft", APPROVED: "Approved", POSTED: "Posted", DISTRIBUTED: "Distributed" };

export async function surplusWorkbook(allocationId: string, coop: string): Promise<Buffer> {
  const a = await getAllocation(allocationId);
  if (!a) throw new SurplusError("Allocation not found");
  const lines = await allocationLines(allocationId);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const title = `Allocation of net surplus, fiscal year ${a.fiscalYear}`;
  const status = `${STATUS[a.status] ?? a.status}${a.gaResolutionNo ? ` · GA resolution ${a.gaResolutionNo}` : ""}`;

  const sum = wb.addWorksheet("Summary");
  sum.addRow([coop]).font = { bold: true, size: 12 };
  sum.addRow([title]).font = { bold: true };
  sum.addRow([status]);
  sum.addRow([]);
  sum.addRow(["", "Rate", "Amount"]).font = { bold: true };
  sum.getColumn(1).width = 48;
  sum.getColumn(2).width = 20;
  sum.getColumn(3).width = 18;
  sum.getColumn(3).numFmt = PESO;
  const row = (label: string, rate: string, amount: Money, bold = false) => {
    const r = sum.addRow([label, rate, pesos(amount)]);
    if (bold) r.font = { bold: true };
  };
  row("Net surplus", "", a.netSurplus, true);
  row("Reserve fund", ratePercent(a.reservePct), a.reserve);
  row("Education and training fund (local)", `${ratePercent(a.etfPct)} ÷ 2`, a.etfLocal);
  row("CETF (to the federation/union)", `${ratePercent(a.etfPct)} ÷ 2`, a.cetf);
  row("Community development fund", ratePercent(a.cdfPct), a.cdf);
  row("Optional fund", ratePercent(a.optionalPct), a.optional);
  row("Remaining for ISC and patronage refund", "", a.remaining, true);
  row("Interest on share capital", `${ratePercent(a.iscShare)} · ${ratePercent(a.iscRate)} of ASM`, a.iscPool);
  row("Patronage refund", `${ratePercent(a.prShare)} · ${ratePercent(a.prRate)} of patronage`, a.prPool);

  const ws = wb.addWorksheet("Members");
  ws.addRow([coop]).font = { bold: true, size: 12 };
  ws.addRow([`Interest on share capital and patronage refund per member, fiscal year ${a.fiscalYear}`]).font = { bold: true };
  ws.addRow([status]);
  ws.addRow([]);
  const cols = ["Member no.", "Name", "ASM", "ISC", "Loan interest", "Store purchases", "Water bills", "Patronage", "Patronage refund", "Gross", "Withholding", "Arrears offset", "Net", "To savings", "To share capital", "In cash"];
  ws.addRow(cols).font = { bold: true };
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 34;
  for (let c = 3; c <= cols.length; c++) {
    ws.getColumn(c).width = 15;
    ws.getColumn(c).numFmt = PESO;
  }
  const amounts = (l: (typeof lines)[number]) => [l.asm, l.isc, l.patronageLoanInterest, l.patronageStore, l.patronageWater, l.patronageTotal, l.pr, l.gross, l.wtax, l.arrearsOffset, l.net, l.payoutSavings, l.payoutCapitalize, l.payoutCash];
  for (const l of lines) ws.addRow([l.memberNo ?? "", l.name, ...amounts(l).map(pesos)]);
  const totals = lines.reduce<Money[]>((t, l) => amounts(l).map((v, i) => (t[i] ?? 0n) + v), []);
  ws.addRow(["Total", `${lines.length} member${lines.length === 1 ? "" : "s"}`, ...totals.map(pesos)]).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
