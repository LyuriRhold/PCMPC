import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import ExcelJS from "exceljs";
import { formatDate, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { cashFlows, changesInEquity, financialCondition, operations, type CashFlows, type ChangesInEquity, type FinancialCondition, type Operations } from "./statements";

/**
 * Financial statement exports (PHASE-14 T14.6): one Excel workbook (a sheet per statement) and one
 * PDF, both from the same statements the screen shows. Excel amounts are numbers of pesos with 2
 * decimals for the bookkeeper's spreadsheet (exact below ₱90 trillion), as in the ledger exports.
 */

export type FsPeriod = { from: BusinessDate; to: BusinessDate };

type Set4 = { sfc: FinancialCondition; soo: Operations; sce: ChangesInEquity; cf: CashFlows };

async function statements(p: FsPeriod): Promise<Set4> {
  const [sfc, soo, sce, cf] = [await financialCondition(p.to), await operations(p.from, p.to), await changesInEquity(p.from, p.to), await cashFlows(p.from, p.to)];
  return { sfc, soo, sce, cf };
}

const SECTION: Record<string, string> = { ASSETS: "Assets", LIABILITIES: "Liabilities", EQUITY: "Equity", REVENUE: "Revenues", EXPENSE: "Expenses", OPERATING: "Operating activities", INVESTING: "Investing activities", FINANCING: "Financing activities" };

// ── Excel ──

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

function sheet(wb: ExcelJS.Workbook, name: string, coop: string, heading: string, sub: string, cols: string[]) {
  const ws = wb.addWorksheet(name);
  ws.addRow([coop]).font = { bold: true, size: 12 };
  ws.addRow([heading]).font = { bold: true };
  ws.addRow([sub]);
  ws.addRow([]);
  ws.addRow(["", ...cols]).font = { bold: true };
  ws.getColumn(1).width = 52;
  for (let c = 2; c <= cols.length + 1; c++) {
    ws.getColumn(c).width = 18;
    ws.getColumn(c).numFmt = PESO;
  }
  return ws;
}

const heading = (ws: ExcelJS.Worksheet, text: string) => (ws.addRow([text]).font = { bold: true });
const total = (ws: ExcelJS.Worksheet, label: string, ...amounts: Money[]) => (ws.addRow([label, ...amounts.map(pesos)]).font = { bold: true });

/** The four statements in one workbook. */
export async function fsWorkbook(p: FsPeriod, coop: string): Promise<Buffer> {
  const { sfc, soo, sce, cf } = await statements(p);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const period = `${formatDate(p.from)} to ${formatDate(p.to)}`;

  const a = sheet(wb, "Financial Condition", coop, sfc.title, `As of ${formatDate(sfc.asOf)}`, ["Amount"]);
  for (const section of ["ASSETS", "LIABILITIES", "EQUITY"]) {
    heading(a, SECTION[section]!);
    for (const l of sfc.lines.filter((x) => x.section === section)) a.addRow([`  ${l.caption}`, pesos(l.amount)]);
    if (section === "ASSETS") total(a, "Total assets", sfc.totals.assets);
    if (section === "LIABILITIES") total(a, "Total liabilities", sfc.totals.liabilities);
    if (section === "EQUITY") total(a, "Total equity", sfc.totals.equity);
  }
  total(a, "Total liabilities and equity", sfc.totals.liabilitiesAndEquity);

  const o = sheet(wb, "Operations", coop, soo.title, period, ["Total", ...soo.segments.map((s) => s.name)]);
  for (const section of ["REVENUE", "EXPENSE"]) {
    heading(o, SECTION[section]!);
    for (const l of soo.lines.filter((x) => x.section === section)) o.addRow([`  ${l.caption}`, pesos(l.amount), ...soo.segments.map((s) => pesos(l.bySegment?.[s.code] ?? 0n))]);
    const key = section === "REVENUE" ? "revenues" : "expenses";
    total(o, section === "REVENUE" ? "Total revenues" : "Total expenses", soo.totals[key], ...soo.segments.map((s) => soo.segmentTotals[s.code]?.[key] ?? 0n));
  }
  total(o, "Net surplus", soo.totals.netSurplus, ...soo.segments.map((s) => soo.segmentTotals[s.code]?.netSurplus ?? 0n));

  const e = sheet(wb, "Changes in Equity", coop, sce.title, period, ["Opening", "Net surplus", "Year-end transfers", "Other changes", "Closing"]);
  for (const r of sce.rows) e.addRow([r.caption, pesos(r.opening), pesos(r.netSurplus), pesos(r.transfers), pesos(r.other), pesos(r.closing)]);
  total(e, "Total equity", sce.total.opening, sce.total.netSurplus, sce.total.transfers, sce.total.other, sce.total.closing);

  const c = sheet(wb, "Cash Flows", coop, cf.title, `${period} (indirect method)`, ["Amount"]);
  for (const activity of ["OPERATING", "INVESTING", "FINANCING"] as const) {
    heading(c, SECTION[activity]!);
    for (const l of cf.lines.filter((x) => x.activity === activity)) c.addRow([`  ${l.caption}`, pesos(l.amount)]);
    total(c, `Net cash from ${SECTION[activity]!.toLowerCase()}`, cf.totals[activity === "OPERATING" ? "operating" : activity === "INVESTING" ? "investing" : "financing"]);
  }
  total(c, "Net change in cash", cf.totals.netChange);
  total(c, "Cash at the beginning", cf.totals.beginningCash);
  total(c, "Cash at the end", cf.totals.endingCash);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──

const fonts = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "DejaVu",
  fonts: [{ src: path.join(fonts, "DejaVuSans.ttf") }, { src: path.join(fonts, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }],
});

const s = StyleSheet.create({
  page: { fontFamily: "DejaVu", fontSize: 9, padding: 36 },
  coop: { fontSize: 12, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 11, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  sub: { textAlign: "center", color: "#555", marginBottom: 10 },
  section: { fontWeight: "bold", marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderTopWidth: 0.5, borderColor: "#000", fontWeight: "bold" },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#000", fontWeight: "bold", marginTop: 4 },
  cell: { width: "14%", textAlign: "right" },
});

function Row({ label, amount, style = s.row, indent = true }: { label: string; amount: Money; style?: typeof s.row; indent?: boolean }) {
  return (
    <View style={style}>
      <Text>{indent ? `   ${label}` : label}</Text>
      <Text>{format(amount)}</Text>
    </View>
  );
}

function Header({ coop, title, sub }: { coop: string; title: string; sub: string }) {
  return (
    <View>
      <Text style={s.coop}>{coop}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.sub}>{sub}</Text>
    </View>
  );
}

function FsDocument({ coop, p, st }: { coop: string; p: FsPeriod; st: Set4 }) {
  const { sfc, soo, sce, cf } = st;
  const period = `For the period ${formatDate(p.from)} to ${formatDate(p.to)}`;
  return (
    <Document title={`Financial statements ${p.from} to ${p.to}`} author={coop}>
      <Page size="A4" style={s.page}>
        <Header coop={coop} title={sfc.title} sub={`As of ${formatDate(sfc.asOf)}`} />
        {(["ASSETS", "LIABILITIES", "EQUITY"] as const).map((section) => (
          <View key={section}>
            <Text style={s.section}>{SECTION[section]}</Text>
            {sfc.lines
              .filter((l) => l.section === section)
              .map((l) => (
                <Row key={l.code} label={l.caption} amount={l.amount} />
              ))}
            <Row label={`Total ${SECTION[section]!.toLowerCase()}`} amount={section === "ASSETS" ? sfc.totals.assets : section === "LIABILITIES" ? sfc.totals.liabilities : sfc.totals.equity} style={s.total} indent={false} />
          </View>
        ))}
        <Row label="Total liabilities and equity" amount={sfc.totals.liabilitiesAndEquity} style={s.grand} indent={false} />
      </Page>
      <Page size="A4" style={s.page}>
        <Header coop={coop} title={soo.title} sub={period} />
        {(["REVENUE", "EXPENSE"] as const).map((section) => (
          <View key={section}>
            <Text style={s.section}>{SECTION[section]}</Text>
            {soo.lines
              .filter((l) => l.section === section)
              .map((l) => (
                <Row key={l.code} label={l.caption} amount={l.amount} />
              ))}
            <Row label={section === "REVENUE" ? "Total revenues" : "Total expenses"} amount={section === "REVENUE" ? soo.totals.revenues : soo.totals.expenses} style={s.total} indent={false} />
          </View>
        ))}
        <Row label="Net surplus" amount={soo.totals.netSurplus} style={s.grand} indent={false} />
        <Text style={s.section}>By business segment</Text>
        {soo.segments.map((seg) => (
          <Row key={seg.code} label={seg.name} amount={soo.segmentTotals[seg.code]?.netSurplus ?? 0n} />
        ))}
      </Page>
      <Page size="A4" style={s.page}>
        <Header coop={coop} title={sce.title} sub={period} />
        {sce.rows.map((r) => (
          <View key={r.code}>
            <Text style={s.section}>{r.caption}</Text>
            <Row label="Balance at the beginning" amount={r.opening} />
            {r.netSurplus ? <Row label="Net surplus for the period" amount={r.netSurplus} /> : null}
            {r.transfers ? <Row label="Year-end transfer" amount={r.transfers} /> : null}
            {r.other ? <Row label="Other changes" amount={r.other} /> : null}
            <Row label="Balance at the end" amount={r.closing} style={s.total} indent={false} />
          </View>
        ))}
        <Row label="Total equity at the end" amount={sce.total.closing} style={s.grand} indent={false} />
        <View break>
          <Header coop={coop} title={cf.title} sub={`${period} (indirect method)`} />
          {(["OPERATING", "INVESTING", "FINANCING"] as const).map((a) => (
            <View key={a}>
              <Text style={s.section}>{SECTION[a]}</Text>
              {cf.lines
                .filter((l) => l.activity === a)
                .map((l) => (
                  <Row key={l.code} label={l.caption} amount={l.amount} />
                ))}
              <Row label={`Net cash from ${SECTION[a]!.toLowerCase()}`} amount={a === "OPERATING" ? cf.totals.operating : a === "INVESTING" ? cf.totals.investing : cf.totals.financing} style={s.total} indent={false} />
            </View>
          ))}
          <Row label="Net change in cash" amount={cf.totals.netChange} style={s.total} indent={false} />
          <Row label="Cash at the beginning" amount={cf.totals.beginningCash} indent={false} />
          <Row label="Cash at the end" amount={cf.totals.endingCash} style={s.grand} indent={false} />
        </View>
      </Page>
    </Document>
  );
}

/** The four statements as one PDF. */
export async function fsPdf(p: FsPeriod, coop: string): Promise<Buffer> {
  const st = await statements(p);
  return renderToBuffer(<FsDocument coop={coop} p={p} st={st} />);
}
