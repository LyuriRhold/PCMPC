import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { releaseQueue } from "@/modules/loans/servicing";

export const metadata: Metadata = { title: "Releases & collections · PCMPC MIS" };

async function ServicingContent() {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const q = await releaseQueue();
  const empty = (cols: number, text: string) => (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-sm text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Releases &amp; collections</h1>
        <p className="text-sm text-muted-foreground">
          A manager other than the approver authorizes each release; the teller then pays out the net proceeds. Payments are collected at the teller counter; penalties are added by the daily job.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approved, waiting for release ({q.approved.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Net proceeds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.approved.length === 0 ? empty(4, "None.") : null}
              {q.approved.map(({ app, member }) => (
                <TableRow key={app.id}>
                  <TableCell>
                    <Link href={`/loans/applications/${app.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {app.appNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {member.lastName}, {member.firstName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(app.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(app.netProceeds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authorized, waiting for the teller&apos;s payout ({q.pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loan</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead className="text-right">Pay out</TableHead>
                <TableHead>First due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.pending.length === 0 ? empty(4, "None.") : null}
              {q.pending.map(({ loan, member }) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <Link href={`/loans/${loan.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {loan.loanNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {member.lastName}, {member.firstName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(loan.netProceeds)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(loan.firstDueDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently released</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loan</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead>Released</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.recent.length === 0 ? empty(5, "None.") : null}
              {q.recent.map(({ loan, member }) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <Link href={`/loans/${loan.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {loan.loanNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {member.lastName}, {member.firstName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(loan.principal)}</TableCell>
                  <TableCell className="tabular-nums">{loan.releaseDate ? formatDate(loan.releaseDate) : ""}</TableCell>
                  <TableCell>{loan.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ServicingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ServicingContent />
    </Suspense>
  );
}
