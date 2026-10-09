import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import type { BillDetail, GridRow } from "./billing-queries";

/**
 * Printed documents (PHASE-06 T6.6): reading sheets per route (A4 landscape) and bills on ¼ or
 * ½-lengthwise short/long bond (water.bill_paper). DejaVu Sans is embedded so the peso sign prints.
 */

const fonts = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "DejaVu",
  fonts: [{ src: path.join(fonts, "DejaVuSans.ttf") }, { src: path.join(fonts, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }],
});
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { fontFamily: "DejaVu", fontSize: 8, padding: 24 },
  h1: { fontSize: 12, fontWeight: "bold" },
  h2: { fontSize: 10, fontWeight: "bold", marginTop: 6 },
  muted: { color: "#555" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#999", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000", paddingVertical: 3, fontWeight: "bold" },
  right: { textAlign: "right" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  box: { borderWidth: 1, borderColor: "#000", padding: 6, marginTop: 6 },
  total: { fontSize: 11, fontWeight: "bold" },
});

const n = (v: number) => v.toLocaleString("en-US");

// ── Reading sheet ──

export type SheetInput = {
  coopName: string;
  period: string;
  zone: string;
  route: { code: string; name: string };
  readingFrom: string;
  readingTo: string;
  rows: GridRow[];
};

const SHEET_COLS = [
  { label: "#", w: "4%" },
  { label: "Account no.", w: "11%" },
  { label: "Customer / service address", w: "29%" },
  { label: "Meter", w: "11%" },
  { label: "Previous", w: "9%", right: true },
  { label: "3-mo avg", w: "8%", right: true },
  { label: "Present", w: "12%" },
  { label: "Remarks", w: "16%" },
];

function ReadingSheet({ d }: { d: SheetInput }) {
  return (
    <Document title={`Reading sheet ${d.route.code} ${d.period}`} author={d.coopName}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.between}>
          <View>
            <Text style={s.h1}>{d.coopName}</Text>
            <Text>
              Reading sheet · {d.period} · Zone {d.zone} · Route {d.route.code} {d.route.name}
            </Text>
          </View>
          <View>
            <Text>
              Reading window: {formatDate(d.readingFrom)} – {formatDate(d.readingTo)}
            </Text>
            <Text>Reader: ______________________ Date: __________</Text>
          </View>
        </View>
        <View style={[s.head, { marginTop: 8 }]} fixed>
          {SHEET_COLS.map((c) => (
            <Text key={c.label} style={[{ width: c.w }, c.right ? s.right : {}]}>
              {c.label}
            </Text>
          ))}
        </View>
        {d.rows.map((r) => (
          <View key={r.accountId} style={[s.row, { minHeight: 22 }]} wrap={false}>
            <Text style={{ width: "4%" }}>{r.sequenceNo}</Text>
            <Text style={{ width: "11%" }}>{r.accountNo}</Text>
            <View style={{ width: "29%" }}>
              <Text>{r.customerName}</Text>
              <Text style={s.muted}>{r.serviceAddress}</Text>
            </View>
            <Text style={{ width: "11%" }}>
              {r.meterSerial} ({r.digits}d)
            </Text>
            <Text style={[{ width: "9%" }, s.right]}>{n(r.previous)}</Text>
            <Text style={[{ width: "8%" }, s.right]}>{r.average === null ? "—" : n(r.average)}</Text>
            <Text style={{ width: "12%", borderBottomWidth: 0.5, marginHorizontal: 4 }}>{r.reading?.presentReading != null ? n(r.reading.presentReading) : " "}</Text>
            <Text style={{ width: "16%" }}>{r.meterChanged ? "Meter changed" : r.estimatedSince ? `Est. ${r.estimatedSince} m³ since last read` : ""}</Text>
          </View>
        ))}
        <Text style={[s.muted, { marginTop: 8 }]}>
          Mark rollover (R) if the dial passed its maximum. Note blocked or broken meters in Remarks. {d.rows.length} account{d.rows.length === 1 ? "" : "s"}.
        </Text>
        <Text style={[s.muted, { position: "absolute", bottom: 12, right: 24 }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function readingSheetPdf(d: SheetInput): Promise<Buffer> {
  return renderToBuffer(<ReadingSheet d={d} />);
}

// ── Bills ──

export type BillPaper = "QUARTER_SHORT" | "QUARTER_LONG" | "HALF_SHORT" | "HALF_LONG";

/**
 * Bills print on short (8.5 × 11 in) or long (8.5 × 13 in) bond, cut into quarters (2 × 2, four
 * bills per sheet) or halves lengthwise (two side by side), per the water.bill_paper setting.
 */
export const PAPER: Record<BillPaper, { sheet: [number, number]; cols: number; rows: number; fontSize: number }> = {
  QUARTER_SHORT: { sheet: [612, 792], cols: 2, rows: 2, fontSize: 6 },
  QUARTER_LONG: { sheet: [612, 936], cols: 2, rows: 2, fontSize: 6.5 },
  HALF_SHORT: { sheet: [612, 792], cols: 2, rows: 1, fontSize: 7.5 },
  HALF_LONG: { sheet: [612, 936], cols: 2, rows: 1, fontSize: 8 },
};

function Bill({ b, coopName, fontSize }: { b: BillDetail; coopName: string; fontSize: number }) {
  const r = b.reading;
  const big = { fontSize: fontSize + 2, fontWeight: "bold" as const };
  const gap = { marginTop: fontSize * 0.6 };
  return (
    <View style={{ fontSize }}>
      <View style={s.between}>
        <View style={{ width: "58%" }}>
          <Text style={big}>{coopName}</Text>
          <Text>Water Service Bill{b.bill.isFinal ? " (FINAL)" : ""}</Text>
        </View>
        <View style={{ width: "42%" }}>
          <Text style={s.right}>{b.bill.billNo}</Text>
          <Text style={s.right}>Period {b.period.period}</Text>
          <Text style={s.right}>Billed {formatDate(b.bill.billDate)}</Text>
        </View>
      </View>

      <View style={[{ borderWidth: 0.75, padding: 3 }, gap]}>
        <Text style={{ fontWeight: "bold" }}>{b.customer.name}</Text>
        <Text>{b.account.serviceAddress}</Text>
        <Text>
          {b.account.accountNo} · {b.bill.classification} · {b.bill.customerType === "MEMBER" ? "Member" : "Non-member"}
        </Text>
        <Text>
          Route {b.route.code} #{b.account.sequenceNo} · Meter {b.meterSerial}
        </Text>
      </View>

      <View style={[s.between, gap]}>
        <Text>Previous reading</Text>
        <Text>{n(r.previousReading)}</Text>
      </View>
      <View style={s.between}>
        <Text>Present reading</Text>
        <Text>{r.presentReading === null ? "Estimated" : n(r.presentReading)}</Text>
      </View>
      <View style={s.between}>
        <Text style={{ fontWeight: "bold" }}>Consumption</Text>
        <Text style={{ fontWeight: "bold" }}>{n(b.bill.consumption)} m³</Text>
      </View>
      {r.type !== "ACTUAL" ? <Text style={s.muted}>{r.type === "ESTIMATED" ? "Estimated: the meter couldn't be read" : r.type === "METER_CHANGE" ? "Meter changed this period" : "Final reading"}</Text> : null}

      <View style={gap}>
        {b.lines.map((l) => (
          <View key={l.id} style={s.between}>
            <Text style={{ width: "72%" }}>{l.description}</Text>
            <Text>{format(l.amount)}</Text>
          </View>
        ))}
      </View>
      <View style={[s.between, { borderTopWidth: 0.5, marginTop: 2, paddingTop: 2 }]}>
        <Text>Current charges</Text>
        <Text>{format(b.bill.currentAmount - b.bill.advanceApplied)}</Text>
      </View>
      <View style={s.between}>
        <Text>Previous balance</Text>
        <Text>{format(b.bill.previousBalance)}</Text>
      </View>
      <View style={[s.between, { borderWidth: 1, padding: 3, marginTop: 3 }]}>
        <Text style={big}>TOTAL AMOUNT DUE</Text>
        <Text style={big}>{format(b.bill.totalAmountDue)}</Text>
      </View>
      <Text style={[{ fontWeight: "bold" }, { marginTop: 2 }]}>Due date: {formatDate(b.bill.dueDate)}</Text>

      <Text style={[{ fontWeight: "bold" }, gap]}>Consumption history (m³)</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {[...b.history].reverse().map((h) => (
          <View key={h.period} style={{ width: "33%", borderWidth: 0.5, padding: 1.5 }}>
            <Text style={s.muted}>{h.period}</Text>
            <Text>
              {n(h.consumption)}
              {h.type === "ESTIMATED" ? " est." : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export async function billsPdf(bills: BillDetail[], coopName: string, title: string, paper: BillPaper = "QUARTER_SHORT"): Promise<Buffer> {
  const p = PAPER[paper];
  const perSheet = p.cols * p.rows;
  const sheets: BillDetail[][] = [];
  for (let i = 0; i < bills.length; i += perSheet) sheets.push(bills.slice(i, i + perSheet));
  const [w, h] = p.sheet;
  const slot = { width: w / p.cols, height: h / p.rows };
  return renderToBuffer(
    <Document title={title} author={coopName}>
      {sheets.map((sheet, i) => (
        <Page key={i} size={{ width: w, height: h }} style={{ fontFamily: "DejaVu", flexDirection: "row", flexWrap: "wrap" }}>
          {sheet.map((b) => (
            // Dashed edges are the cut lines.
            <View key={b.bill.id} style={{ width: slot.width, height: slot.height, padding: 14, borderWidth: 0.5, borderStyle: "dashed", borderColor: "#999" }}>
              <Bill b={b} coopName={coopName} fontSize={p.fontSize} />
            </View>
          ))}
        </Page>
      ))}
    </Document>,
  );
}
