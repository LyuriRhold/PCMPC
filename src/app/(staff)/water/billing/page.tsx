import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { listPeriods } from "@/modules/water/billing-queries";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Billing runs · PCMPC MIS" };

async function BillingContent() {
  const access = await guardPage("water.bill");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const periods = await listPeriods();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Billing runs</h1>
        <p className="text-sm text-muted-foreground">
          One run per zone and period: preview the bills, then post them. Posting is blocked until every active account has an approved reading or an approved exclusion, and a
          period is billed only once.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Zone</TableHead>
            <TableHead>Bill date</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead className="text-right">Readings</TableHead>
            <TableHead className="text-right">Bills</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="sr-only">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No billing periods yet. Open one under Meter readings.
              </TableCell>
            </TableRow>
          ) : null}
          {periods.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-mono text-xs">{p.period}</TableCell>
              <TableCell>
                {p.zoneCode} · {p.zoneName}
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(p.billDate)}</TableCell>
              <TableCell className="tabular-nums">{formatDate(p.dueDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.readings}</TableCell>
              <TableCell className="text-right tabular-nums">{p.bills}</TableCell>
              <TableCell>
                <WaterStatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/water/billing/${p.id}`} className="text-sm underline underline-offset-4">
                  Bill
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BillingContent />
    </Suspense>
  );
}
