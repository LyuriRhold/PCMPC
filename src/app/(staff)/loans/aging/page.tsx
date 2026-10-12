import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { parPercent } from "@/modules/loans/aging";
import { delinquencyList, portfolio } from "@/modules/loans/servicing";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Aging & PAR · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function AgingContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z.object({ asOf: one }).parse(await searchParams);
  const asOf = sp.asOf && isBusinessDate(sp.asOf) ? sp.asOf : businessToday();
  const [rows, delinquent, buckets, threshold] = await Promise.all([portfolio(asOf), delinquencyList(asOf), getSetting("loan.aging_buckets"), getSetting("loan.par_threshold_days")]);
  const par = parPercent(rows, threshold);
  const total = rows.reduce((s, r) => s + r.outstandingPrincipal, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Aging &amp; PAR</h1>
        <p className="text-sm text-muted-foreground">Days past due count from the oldest unpaid installment. PAR is the outstanding principal of loans more than {threshold} days past due over the whole portfolio.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asOf">As of</Label>
          <Input id="asOf" name="asOf" type="date" defaultValue={asOf} />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Portfolio at risk (&gt; {threshold} days)</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="par">
            {par}%
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Outstanding principal</p>
          <p className="text-2xl font-semibold tabular-nums">{format(total)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Loans past due</p>
          <p className="text-2xl font-semibold tabular-nums">
            {delinquent.length} of {rows.length}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aging as of {formatDate(asOf)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Days past due</TableHead>
                <TableHead className="text-right">Loans</TableHead>
                <TableHead className="text-right">Outstanding principal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => {
                const inBucket = rows.filter((r) => r.bucket === b.label);
                return (
                  <TableRow key={b.label}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{inBucket.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(inBucket.reduce((s, r) => s + r.outstandingPrincipal, 0n))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delinquency list</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loan</TableHead>
                <TableHead>Borrower · mobile</TableHead>
                <TableHead>Comakers · mobile</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Past due (incl. penalties)</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delinquent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No loans past due.
                  </TableCell>
                </TableRow>
              ) : null}
              {delinquent.map((r) => (
                <TableRow key={r.loan.id}>
                  <TableCell>
                    <Link href={`/loans/${r.loan.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {r.loan.loanNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.member.lastName}, {r.member.firstName}
                    <div className="text-xs text-muted-foreground">{r.member.mobile ?? "no mobile"}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.comakers.length ? r.comakers.map((c) => `${c.name} · ${c.mobile ?? "no mobile"}`).join("; ") : "None"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.daysPastDue}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.amountPastDue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.outstandingPrincipal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AgingPage(props: PageProps<"/loans/aging">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AgingContent searchParams={props.searchParams} />
    </Suspense>
  );
}
