import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { listFees, listRateSchedules } from "@/modules/water/queries";
import { RateScheduleForm } from "@/modules/water/ui/forms";
import { WATER_STAFF } from "@/modules/water/ui/shared";

export const metadata: Metadata = { title: "Tariffs & fees · PCMPC MIS" };

async function TariffsContent() {
  const access = await guardPageAny(WATER_STAFF);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [schedules, fees] = await Promise.all([listRateSchedules(), listFees()]);
  const today = businessToday();
  // The version in force today is the latest one per classification that has started.
  const inForce = new Set<string>();
  const seen = new Set<string>();
  for (const s of schedules) {
    if (!seen.has(s.classification) && s.effectiveFrom <= today) {
      inForce.add(s.id);
      seen.add(s.classification);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Tariffs &amp; fees</h1>
        <p className="text-sm text-muted-foreground">
          Rate versions are never edited: a new NWRB-approved tariff is added as a new version with its effective date. Bills use the version in force on the billing period&apos;s end date.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rate schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classification</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead className="text-right">Minimum charge</TableHead>
                <TableHead>Blocks</TableHead>
                <TableHead>NWRB ref.</TableHead>
                <TableHead className="sr-only">In force</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No rate schedules.
                  </TableCell>
                </TableRow>
              ) : null}
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{s.classification}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(s.effectiveFrom)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format(s.minCharge)} <span className="text-xs text-muted-foreground">(first {s.minCubic} m³)</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.blocks.map((b) => (
                      <div key={b.from}>
                        {b.from}
                        {b.to === null ? "+" : `–${b.to}`} m³: {format(BigInt(b.rate))}/m³
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="max-w-64 text-xs">{s.nwrbRef}</TableCell>
                  <TableCell>{inForce.has(s.id) ? <Badge>In force</Badge> : s.effectiveFrom > today ? <Badge variant="outline">Upcoming</Badge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {can(access.user, "water.rates") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a rate version</CardTitle>
          </CardHeader>
          <CardContent>
            <RateScheduleForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Fee schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Credited to</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.code}</TableCell>
                  <TableCell>{f.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(f.amount)}</TableCell>
                  <TableCell className="font-mono text-xs">{f.mappingKey}</TableCell>
                  <TableCell>{f.isActive ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TariffsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TariffsContent />
    </Suspense>
  );
}
