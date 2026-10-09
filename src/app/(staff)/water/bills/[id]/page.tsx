import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { billDetail } from "@/modules/water/billing-queries";
import { MemoDecision, MemoForm } from "@/modules/water/ui/billing-forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Water bill · PCMPC MIS" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

async function BillContent(props: PageProps<"/water/bills/[id]">) {
  const access = await guardPageAny(["water.bill", "water.adjust_prepare", "water.adjust_approve"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const d = await billDetail(id);
  if (!d) notFound();
  const { bill: b, reading: r } = d;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/water/bills" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Bills &amp; adjustments
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            Bill {b.billNo}
            {b.isFinal ? " (final)" : ""}
          </h1>
          <WaterStatusBadge status={b.status} />
          <a href={`/api/water/bills/${b.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
            Print (PDF)
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bill</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row
              label="Customer"
              value={
                <Link href={`/water/customers/${d.customer.id}`} className="underline underline-offset-4">
                  {d.customer.name} ({d.customer.customerNo})
                </Link>
              }
            />
            <Row
              label="Account"
              value={
                <Link href={`/water/connections/${d.account.id}`} className="underline underline-offset-4">
                  {d.account.accountNo} · {b.classification} · {b.customerType === "MEMBER" ? "Member" : "Non-member"}
                </Link>
              }
            />
            <Row label="Period" value={`${d.period.period} · zone ${d.zone.code}`} />
            <Row label="Bill / due date" value={`${formatDate(b.billDate)} / ${formatDate(b.dueDate)}`} />
            <Row label="Readings" value={`${r.previousReading.toLocaleString("en-US")} → ${r.presentReading === null ? "estimated" : r.presentReading.toLocaleString("en-US")} (${r.type})`} />
            <Row label="Consumption" value={`${b.consumption} m³`} />
            <Row
              label="Journal entry"
              value={
                <Link href={`/accounting/journals/${b.jeId}`} className="underline underline-offset-4">
                  Open entry
                </Link>
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {d.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(l.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Current charges (net of advances)</TableCell>
                <TableCell className="text-right tabular-nums">{format(b.currentAmount - b.advanceApplied)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Previous balance</TableCell>
                <TableCell className="text-right tabular-nums">{format(b.previousBalance)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">Total amount due</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{format(b.totalAmountDue)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credit and debit memos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Memo</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Prepared</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="sr-only">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.memos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No memos.
                  </TableCell>
                </TableRow>
              ) : null}
              {d.memos.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{m.kind}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(m.amount)}</TableCell>
                  <TableCell>
                    {m.reason}
                    {m.rejectedReason ? <div className="text-xs text-destructive">Rejected: {m.rejectedReason}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.preparedByName} · {formatDateTime(m.createdAt)}
                    {m.approvedByName ? <div>Approved by {m.approvedByName}</div> : null}
                  </TableCell>
                  <TableCell>
                    <WaterStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {m.status === "PENDING" && can(access.user, "water.adjust_approve") && m.preparedBy !== access.user.id ? <MemoDecision memoId={m.id} label={`${m.kind} ${b.billNo}`} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {can(access.user, "water.adjust_prepare") && b.status !== "CANCELLED" ? <MemoForm billId={b.id} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillPage(props: PageProps<"/water/bills/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <BillContent {...props} />
    </Suspense>
  );
}
