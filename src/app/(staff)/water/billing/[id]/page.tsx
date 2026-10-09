import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { previewRun } from "@/modules/water/billing";
import { getPeriod, periodBills } from "@/modules/water/billing-queries";
import { listRoutes } from "@/modules/water/queries";
import { customerName } from "@/modules/water/service";
import { ClosePeriodButton, PostRunButton } from "@/modules/water/ui/billing-forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Billing run · PCMPC MIS" };

async function RunContent(props: PageProps<"/water/billing/[id]">) {
  const access = await guardPage("water.bill");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const period = await getPeriod(id);
  if (!period) notFound();
  const billed = period.status === "BILLED" || period.status === "CLOSED";

  const header = (
    <div className="flex flex-col gap-1">
      <Link href="/water/billing" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Billing runs
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          Billing run {period.period} · {period.zone.code} {period.zone.name}
        </h1>
        <WaterStatusBadge status={period.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        Bill date {formatDate(period.billDate)} · due {formatDate(period.dueDate)} ·{" "}
        <Link href={`/water/readings/${id}`} className="underline underline-offset-4">
          Readings
        </Link>
      </p>
    </div>
  );

  if (billed) {
    const bills = await periodBills(id);
    const routes = (await listRoutes()).filter((r) => bills.some((b) => b.routeId === r.id));
    const total = bills.reduce((s, b) => s + b.currentAmount, 0n);
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm dark:bg-green-950/30">
          Billed: {bills.length} bill{bills.length === 1 ? "" : "s"}, {format(total)} in current charges.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href={`/api/water/periods/${id}/bills`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            All bills (PDF)
          </a>
          {routes.map((r) => (
            <a key={r.id} href={`/api/water/periods/${id}/bills?route=${r.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Bills {r.code} (PDF)
            </a>
          ))}
          {period.status === "BILLED" ? <ClosePeriodButton periodId={id} /> : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill no.</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">m³</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Previous balance</TableHead>
              <TableHead className="text-right">Total due</TableHead>
              <TableHead className="sr-only">PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/water/bills/${b.id}`} className="underline-offset-4 hover:underline">
                    {b.billNo}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.accountNo}</TableCell>
                <TableCell>{b.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">{b.consumption}</TableCell>
                <TableCell className="text-right tabular-nums">{format(b.currentAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(b.previousBalance)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(b.totalAmountDue)}</TableCell>
                <TableCell className="text-right">
                  <a href={`/api/water/bills/${b.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`Bill PDF ${b.accountNo}`} className="text-sm underline underline-offset-4">
                    PDF
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  const { bills, blockers } = await previewRun(id);
  const sum = (f: (b: (typeof bills)[number]) => bigint) => bills.reduce((s, b) => s + f(b), 0n);
  return (
    <div className="flex flex-col gap-5">
      {header}
      {blockers.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Not ready to bill</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm">
              {blockers.map((b) => (
                <li key={b.accountId}>
                  {b.accountNo}: {b.problem}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Preview ({bills.length} bill{bills.length === 1 ? "" : "s"})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">m³</TableHead>
                <TableHead className="text-right">Basic</TableHead>
                <TableHead className="text-right">Senior disc.</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Advance</TableHead>
                <TableHead className="text-right">Previous bal.</TableHead>
                <TableHead className="text-right">Total due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((b) => (
                <TableRow key={b.account.id}>
                  <TableCell className="font-mono text-xs">{b.account.accountNo}</TableCell>
                  <TableCell>{customerName(b.customer)}</TableCell>
                  <TableCell className="text-xs">{b.customer.type === "MEMBER" ? "Member" : "Non-member"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.consumption}
                    {b.reading.type === "ESTIMATED" ? " (est.)" : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.basicCharge)}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.seniorDiscount ? format(-b.seniorDiscount) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.currentAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.advanceApplied ? format(-b.advanceApplied) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.previousBalance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(b.totalAmountDue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>Totals</TableCell>
                <TableCell className="text-right tabular-nums">{format(sum((b) => b.basicCharge))}</TableCell>
                <TableCell className="text-right tabular-nums">{format(-sum((b) => b.seniorDiscount))}</TableCell>
                <TableCell className="text-right tabular-nums">{format(sum((b) => b.currentAmount))}</TableCell>
                <TableCell className="text-right tabular-nums">{format(-sum((b) => b.advanceApplied))}</TableCell>
                <TableCell className="text-right tabular-nums">{format(sum((b) => b.previousBalance))}</TableCell>
                <TableCell className="text-right tabular-nums">{format(sum((b) => b.totalAmountDue))}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {blockers.length === 0 ? <PostRunButton periodId={id} count={bills.length} /> : <p className="text-sm text-muted-foreground">Resolve the accounts above before posting.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingRunPage(props: PageProps<"/water/billing/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <RunContent {...props} />
    </Suspense>
  );
}
