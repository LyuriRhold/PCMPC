import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { guardPageAny } from "@/lib/page-guard";
import { listPeriods, listZones } from "@/modules/water/billing-queries";
import { OpenPeriodForm } from "@/modules/water/ui/billing-forms";
import { WaterStatusBadge } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Meter readings · PCMPC MIS" };

async function ReadingsContent() {
  const access = await guardPageAny(["water.bill", "water.review_readings"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [periods, zones] = await Promise.all([listPeriods(), listZones()]);
  const today = businessToday();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Meter readings</h1>
        <p className="text-sm text-muted-foreground">
          Open a zone&apos;s billing period, print the route sheets, encode the readings, then review the flagged ones before the billing run.
        </p>
      </div>

      {can(access.user, "water.bill") ? (
        <Card>
          <CardHeader>
            <CardTitle>Open a billing period</CardTitle>
          </CardHeader>
          <CardContent>
            <OpenPeriodForm zones={zones} defaults={{ period: today.slice(0, 7), readingFrom: `${today.slice(0, 7)}-01`, readingTo: today, billDate: today }} />
          </CardContent>
        </Card>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Zone</TableHead>
            <TableHead>Reading window</TableHead>
            <TableHead>Bill date</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead className="text-right">Readings</TableHead>
            <TableHead className="text-right">Flagged</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="sr-only">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                No billing periods yet.
              </TableCell>
            </TableRow>
          ) : null}
          {periods.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-mono text-xs">{p.period}</TableCell>
              <TableCell>
                {p.zoneCode} · {p.zoneName}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDate(p.readingFrom)} – {formatDate(p.readingTo)}
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(p.billDate)}</TableCell>
              <TableCell className="tabular-nums">{formatDate(p.dueDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.readings}</TableCell>
              <TableCell className="text-right tabular-nums">{p.flagged || "—"}</TableCell>
              <TableCell>
                <WaterStatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/water/readings/${p.id}`} className="text-sm underline underline-offset-4">
                  Readings
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ReadingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReadingsContent />
    </Suspense>
  );
}
