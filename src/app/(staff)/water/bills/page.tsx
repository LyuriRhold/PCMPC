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
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { pendingMemos, searchBills } from "@/modules/water/billing-queries";
import { MemoDecision } from "@/modules/water/ui/billing-forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Bills & adjustments · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function BillsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["water.bill", "water.adjust_prepare", "water.adjust_approve"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const q = one.parse((await searchParams).q);
  const [bills, memos] = await Promise.all([searchBills({ q }), pendingMemos()]);
  const canApprove = can(access.user, "water.adjust_approve");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Bills &amp; adjustments</h1>
        <p className="text-sm text-muted-foreground">Posted bills are never edited. Corrections are credit or debit memos, approved by someone other than the preparer.</p>
      </div>

      {memos.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Memos waiting for approval ({memos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Prepared</TableHead>
                  <TableHead className="sr-only">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/water/bills/${m.billId}`} className="underline-offset-4 hover:underline">
                        {m.billNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{m.kind}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(m.amount)}</TableCell>
                    <TableCell>{m.reason}</TableCell>
                    <TableCell className="text-xs">
                      {m.preparedByName} · {formatDateTime(m.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canApprove && m.preparedBy !== access.user.id ? <MemoDecision memoId={m.id} label={`${m.kind} ${m.billNo}`} /> : <span className="text-xs text-muted-foreground">Another approver decides</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Find bill no., account no. or customer</Label>
          <Input id="q" name="q" defaultValue={q ?? ""} placeholder="e.g. WB-202610-000001, WA-000001, santos" />
        </div>
        <Button type="submit" size="sm">
          Find
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bill no.</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">m³</TableHead>
            <TableHead className="text-right">Current</TableHead>
            <TableHead className="text-right">Total due</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bills.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                No bills found.
              </TableCell>
            </TableRow>
          ) : null}
          {bills.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono text-xs">
                <Link href={`/water/bills/${b.id}`} className="underline-offset-4 hover:underline">
                  {b.billNo}
                </Link>
                {b.isFinal ? " (final)" : ""}
              </TableCell>
              <TableCell className="font-mono text-xs">{b.period}</TableCell>
              <TableCell className="font-mono text-xs">{b.accountNo}</TableCell>
              <TableCell>{b.customerName}</TableCell>
              <TableCell className="text-right tabular-nums">{b.consumption}</TableCell>
              <TableCell className="text-right tabular-nums">{format(b.currentAmount)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(b.totalAmountDue)}</TableCell>
              <TableCell className="tabular-nums">{formatDate(b.dueDate)}</TableCell>
              <TableCell>
                <WaterStatusBadge status={b.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function BillsPage(props: PageProps<"/water/bills">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <BillsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
