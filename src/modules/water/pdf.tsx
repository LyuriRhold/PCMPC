import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import type { BillDetail, GridRow } from "./billing-queries";

/**
 * Printed documents (PHASE-06 T6.6): reading sheets per route (A4 landscape) and bills, one per
 * A5 page (CONFIRM: the bill layout and paper size are PCMPC inputs). DejaVu Sans is embedded so
 * the peso sign prints.
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

function Bill({ b, coopName }: { b: BillDetail; coopName: string }) {
  const r = b.reading;
  return (
    <View style={{ marginBottom: 12 }} wrap={false}>
      <View style={s.between}>
        <View>
          <Text style={s.h1}>{coopName}</Text>
          <Text>Water Service Bill{b.bill.isFinal ? " (FINAL)" : ""}</Text>
        </View>
        <View>
          <Text style={s.right}>Bill no. {b.bill.billNo}</Text>
          <Text style={s.right}>Period {b.period.period}</Text>
          <Text style={s.right}>Bill date {formatDate(b.bill.billDate)}</Text>
        </View>
      </View>

      <View style={[s.box, s.between]}>
        <View style={{ width: "60%" }}>
          <Text style={{ fontWeight: "bold" }}>{b.customer.name}</Text>
          <Text>{b.account.serviceAddress}</Text>
          <Text>
            Account {b.account.accountNo} · {b.bill.classification} · {b.bill.customerType === "MEMBER" ? "Member" : "Non-member"}
          </Text>
          <Text>
            Route {b.route.code} #{b.account.sequenceNo} · Meter {b.meterSerial}
          </Text>
        </View>
        <View style={{ width: "38%" }}>
          <View style={s.between}>
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
          {r.remarks && r.type !== "ACTUAL" ? <Text style={s.muted}>{r.remarks}</Text> : null}
        </View>
      </View>

      <Text style={s.h2}>Charges</Text>
      {b.lines.map((l) => (
        <View key={l.id} style={s.between}>
          <Text>{l.description}</Text>
          <Text>{format(l.amount)}</Text>
        </View>
      ))}
      <View style={[s.between, { borderTopWidth: 0.5, marginTop: 2, paddingTop: 2 }]}>
        <Text>Current charges</Text>
        <Text>{format(b.bill.currentAmount - b.bill.advanceApplied)}</Text>
      </View>
      <View style={s.between}>
        <Text>Previous balance</Text>
        <Text>{format(b.bill.previousBalance)}</Text>
      </View>
      <View style={[s.box, s.between]}>
        <Text style={s.total}>TOTAL AMOUNT DUE</Text>
        <Text style={s.total}>{format(b.bill.totalAmountDue)}</Text>
      </View>
      <View style={[s.between, { marginTop: 2 }]}>
        <Text style={{ fontWeight: "bold" }}>Due date: {formatDate(b.bill.dueDate)}</Text>
        <Text style={s.muted}>Please pay on or before the due date.</Text>
      </View>

      <Text style={s.h2}>Consumption history (m³)</Text>
      <View style={{ flexDirection: "row" }}>
        {[...b.history].reverse().map((h) => (
          <View key={h.period} style={{ width: "16%", borderWidth: 0.5, padding: 2, marginRight: 2 }}>
            <Text style={s.muted}>{h.period}</Text>
            <Text>
              {n(h.consumption)}
              {h.type === "ESTIMATED" ? " (est.)" : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export async function billsPdf(bills: BillDetail[], coopName: string, title: string): Promise<Buffer> {
  return renderToBuffer(
    <Document title={title} author={coopName}>
      {bills.map((b) => (
        <Page key={b.bill.id} size="A5" style={s.page}>
          <Bill b={b} coopName={coopName} />
        </Page>
      ))}
    </Document>,
  );
}
