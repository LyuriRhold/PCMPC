import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { dashboardKpis } from "@/modules/reports/kpis";

export const metadata: Metadata = { title: "Management dashboard · PCMPC MIS" };

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

async function DashboardContent() {
  const access = await guardPage("reports.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const k = await dashboardKpis();
  const off = k.reconciliation.filter((r) => r.difference !== 0n);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Management dashboard</h1>
        <p className="text-sm text-muted-foreground">
          As of {formatDate(k.asOf)}. Balances are from the books (GL control accounts); the footer compares them with the member records.
        </p>
      </div>

      <Section title="Members and capital">
        <Tile label="Active members" value={k.members.total} note={`${k.members.regular.total} regular · ${k.members.associate.total} associate`} />
        <Tile label="New members this month" value={k.members.newThisMonth} />
        <Tile label="Paid-up share capital" value={format(k.paidUp)} />
        <Tile label="Deposits" value={format(k.deposits)} note="Savings and time deposits" />
      </Section>

      <Section title="Credit">
        <Tile label="Loan portfolio" value={format(k.loanPortfolio)} note="Outstanding principal" />
        <Tile label={`Portfolio at risk (> ${k.par.thresholdDays} days)`} value={k.par.percent} />
        <Tile label="Loan collection efficiency (this month)" value={k.loanEfficiency.percent ?? "No dues yet"} note={`${format(k.loanEfficiency.collected)} of ${format(k.loanEfficiency.due)}`} />
        <Tile label="Loans due this week" value={k.alerts.loansDueThisWeek.loans} note={format(k.alerts.loansDueThisWeek.amount)} />
      </Section>

      <Section title="Water this month">
        <Tile label="Billed (due this month)" value={format(k.water.billed)} />
        <Tile label="Collected on those bills" value={format(k.water.collected)} note={`Collection efficiency ${k.water.efficiency ?? "n/a"}`} />
        <Tile label="Active connections" value={k.water.activeConnections} note={`Non-revenue water ${k.water.nrw ?? "not measured"}`} />
        <Tile label="For disconnection" value={k.water.forDisconnection} />
      </Section>

      <Section title="Store and cash">
        <Tile label="Store sales this month" value={format(k.store.mtd.net)} note={`Gross margin ${format(k.store.mtd.margin)} (${k.store.mtd.marginPct})`} />
        <Tile label="Store sales this year" value={format(k.store.ytd.net)} note={`Gross margin ${format(k.store.ytd.margin)} (${k.store.ytd.marginPct})`} />
        <Tile label="Cash on hand" value={format(k.cash.onHand)} />
        <Tile label="Cash in bank" value={format(k.cash.inBank)} />
      </Section>

      <Section title="Alerts">
        <Tile label="Time deposits matured or maturing this week" value={k.alerts.maturingTimeDeposits.length} note={k.alerts.maturingTimeDeposits.map((t) => `${t.memberNo} ${formatDate(t.maturityDate)}`).join(", ") || undefined} />
        <Tile
          label="Products to reorder"
          value={k.alerts.lowStock}
          note={
            <Link href="/store/inventory" className="underline underline-offset-4">
              Inventory
            </Link>
          }
        />
      </Section>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Reconciliation with the books</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Control account</TableHead>
              <TableHead className="text-right">Books (GL)</TableHead>
              <TableHead className="text-right">Member records</TableHead>
              <TableHead className="text-right">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {k.reconciliation.map((r) => (
              <TableRow key={r.label}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{format(r.gl)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(r.subsidiary)}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.difference === 0n ? "" : "text-destructive"}`}>{format(r.difference)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">{off.length ? "A difference means entries were posted to a control account without a member record (e.g. a manual JV); the bookkeeper should look into it." : "The member records agree with the books."}</p>
      </div>
    </div>
  );
}

export default function ManagementDashboardPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
