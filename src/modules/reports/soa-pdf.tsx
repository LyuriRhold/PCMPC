import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import type { MemberSoa } from "./soa";

/** The member statement of account as a PDF (PHASE-16 T16.5); DejaVu Sans is embedded so the peso sign prints. */

const fonts = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "DejaVu",
  fonts: [{ src: path.join(fonts, "DejaVuSans.ttf") }, { src: path.join(fonts, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }],
});

const s = StyleSheet.create({
  page: { fontFamily: "DejaVu", fontSize: 9, padding: 36 },
  coop: { fontSize: 12, fontWeight: "bold" },
  title: { fontSize: 11, fontWeight: "bold", marginTop: 4 },
  muted: { color: "#555" },
  h: { fontWeight: "bold", marginTop: 12, marginBottom: 4, fontSize: 10 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 2 },
  head: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 2, fontWeight: "bold" },
  cell: { flex: 2 },
  num: { flex: 1, textAlign: "right" },
});

function Line({ cells, head = false }: { cells: Array<{ text: string; num?: boolean }>; head?: boolean }) {
  return (
    <View style={head ? s.head : s.row}>
      {cells.map((c, i) => (
        <Text key={i} style={c.num ? s.num : s.cell}>
          {c.text}
        </Text>
      ))}
    </View>
  );
}

function SoaDocument({ soa, coop }: { soa: MemberSoa; coop: string }) {
  return (
    <Document title={`Statement of account ${soa.member.memberNo ?? ""}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.coop}>{coop}</Text>
        <Text style={s.title}>Statement of account as of {formatDate(soa.asOf)}</Text>
        <Text>
          {soa.member.memberNo} · {soa.member.name} · {soa.member.type === "ASSOCIATE" ? "Associate" : "Regular"} member
          {soa.member.membershipDate ? ` since ${formatDate(soa.member.membershipDate)}` : ""}
        </Text>

        <Text style={s.h}>Share capital</Text>
        <Line head cells={[{ text: "Subscribed", num: true }, { text: "Paid-up", num: true }, { text: "Unpaid subscription", num: true }]} />
        <Line cells={[{ text: format(soa.share.subscribed), num: true }, { text: format(soa.share.paidUp), num: true }, { text: format(soa.share.unpaid), num: true }]} />

        <Text style={s.h}>Savings</Text>
        <Line head cells={[{ text: "Account" }, { text: "Product" }, { text: "Balance", num: true }]} />
        {soa.savings.length ? soa.savings.map((a) => <Line key={a.accountNo} cells={[{ text: a.accountNo }, { text: a.product }, { text: format(a.balance), num: true }]} />) : <Text style={s.muted}>No savings account.</Text>}

        {soa.timeDeposits.length ? (
          <>
            <Text style={s.h}>Time deposits</Text>
            <Line head cells={[{ text: "Certificate" }, { text: "Matures" }, { text: "Principal", num: true }]} />
            {soa.timeDeposits.map((t) => (
              <Line key={t.certificateNo} cells={[{ text: t.certificateNo }, { text: formatDate(t.maturityDate) }, { text: format(t.principal), num: true }]} />
            ))}
          </>
        ) : null}

        <Text style={s.h}>Loans</Text>
        <Line head cells={[{ text: "Loan" }, { text: "Product" }, { text: "Principal balance", num: true }, { text: "Unpaid interest", num: true }, { text: "Past due", num: true }]} />
        {soa.loans.length ? (
          soa.loans.map((l) => (
            <Line
              key={l.loanNo}
              cells={[{ text: l.loanNo }, { text: l.product }, { text: format(l.outstandingPrincipal), num: true }, { text: format(l.unpaidInterest), num: true }, { text: `${format(l.arrears)}${l.daysPastDue ? ` (${l.daysPastDue} days)` : ""}`, num: true }]}
            />
          ))
        ) : (
          <Text style={s.muted}>No open loan.</Text>
        )}

        <Text style={s.h}>Store account</Text>
        <Text>{soa.storeAr === 0n ? "Nothing owed to the store." : `Owed to the store: ${format(soa.storeAr)}`}</Text>

        <Text style={[s.muted, { marginTop: 18 }]}>
          Balances agree with the cooperative&apos;s books{soa.reconciliation.some((r) => r.difference !== 0n) ? " except where noted by the bookkeeper" : ""}. Please report any discrepancy to the office.
        </Text>
      </Page>
    </Document>
  );
}

export async function soaPdf(soa: MemberSoa, coop: string): Promise<Buffer> {
  return renderToBuffer(<SoaDocument soa={soa} coop={coop} />);
}
