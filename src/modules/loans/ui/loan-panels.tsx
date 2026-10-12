import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { getSetting } from "@/modules/settings/service";
import { parPercent } from "../aging";
import { memberApplications } from "../service";
import { memberLoans, portfolio } from "../servicing";

/** Dashboard: portfolio at risk and outstanding principal today. */
export async function LoanTiles() {
  const [rows, threshold] = await Promise.all([portfolio(businessToday()), getSetting("loan.par_threshold_days")]);
  const tiles = [
    { label: `Portfolio at risk (> ${threshold} days)`, value: `${parPercent(rows, threshold)}%` },
    { label: "Outstanding loans", value: format(rows.reduce((s, r) => s + r.outstandingPrincipal, 0n)) },
    { label: "Loans past due", value: `${rows.filter((r) => r.daysPastDue > 0).length} of ${rows.length}` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <Link key={t.label} href="/loans/aging" className="rounded-lg border p-3 hover:bg-muted/50">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          <p className="text-lg font-semibold tabular-nums">{t.value}</p>
        </Link>
      ))}
    </div>
  );
}

/** Member profile: the member's loans and applications. */
export async function MemberLoansPanel({ memberId }: { memberId: string }) {
  const [loans, applications] = await Promise.all([memberLoans(memberId), memberApplications(memberId)]);
  return (
    <div className="flex flex-col gap-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Principal</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead>Released</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loans.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No loans.
              </TableCell>
            </TableRow>
          ) : null}
          {loans.map(({ loan, outstandingPrincipal }) => (
            <TableRow key={loan.id}>
              <TableCell>
                <Link href={`/loans/${loan.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {loan.loanNo}
                </Link>
              </TableCell>
              <TableCell>{loan.status}</TableCell>
              <TableCell className="text-right tabular-nums">{format(loan.principal)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(outstandingPrincipal)}</TableCell>
              <TableCell className="tabular-nums">{loan.releaseDate ? formatDate(loan.releaseDate) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No applications.
              </TableCell>
            </TableRow>
          ) : null}
          {applications.map((a) => (
            <TableRow key={a.application.id}>
              <TableCell>
                <Link href={`/loans/applications/${a.application.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {a.application.appNo}
                </Link>
              </TableCell>
              <TableCell>{a.productName}</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.application.amount)}</TableCell>
              <TableCell>{a.application.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
