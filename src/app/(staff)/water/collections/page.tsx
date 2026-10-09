import Decimal from "decimal.js";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { getSetting } from "@/modules/settings/service";
import { dailyCollections, recentPenalties } from "@/modules/water/reports";
import { RunJobsButton } from "@/modules/water/ui/collection-forms";
import { WATER_REPORT_VIEWERS } from "@/modules/water/ui/report-access";
import { Tiles } from "@/modules/water/ui/tiles";

export const metadata: Metadata = { title: "Collections & penalties · PCMPC MIS" };

async function CollectionsContent() {
  const access = await guardPageAny(WATER_REPORT_VIEWERS);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const today = businessToday();
  const [collections, penalties, pct] = await Promise.all([dailyCollections(today), recentPenalties(), getSetting("water.penalty_pct")]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Collections &amp; penalties</h1>
        <p className="text-sm text-muted-foreground">
          Water bills are paid at the teller counter (payor type Water customer): oldest bill first, penalty before bill; anything extra becomes an advance for the next bill. A
          bill still unpaid after its due date gets a {new Decimal(pct).mul(100).toString()}% penalty once, assessed by the daily job.
        </p>
        <p className="text-sm">
          <Link href="/water/reports?report=aging" className="underline underline-offset-4">
            AR aging
          </Link>
          {" · "}
          <Link href="/water/reports?report=daily-collections" className="underline underline-offset-4">
            Daily collection report
          </Link>
          {" · "}
          <Link href="/water/reports?report=collection-efficiency" className="underline underline-offset-4">
            Collection efficiency
          </Link>
          {" · "}
          <Link href="/water/customers" className="underline underline-offset-4">
            Customer statements of account
          </Link>
        </p>
      </div>
      <Tiles />
      {can(access.user, "water.bill") ? (
        <div className="flex flex-col gap-1">
          <RunJobsButton />
          <p className="text-xs text-muted-foreground">The server runs these every day at 1:00 AM (Manila). Running them again the same day does nothing.</p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Water payments today ({formatDate(today)})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teller</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Payor</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No water payments yet today.
                  </TableCell>
                </TableRow>
              ) : null}
              {collections.rows.map((r, i) => (
                <TableRow key={`${r.receiptNo}-${i}`}>
                  <TableCell>{r.teller}</TableCell>
                  <TableCell className="font-mono text-xs">{r.receiptNo}</TableCell>
                  <TableCell>{r.payor}</TableCell>
                  <TableCell className="text-xs">{r.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>Total</TableCell>
                <TableCell className="text-right tabular-nums">{format(collections.total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Penalties assessed</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assessed</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Penalty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {penalties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No penalties yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {penalties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular-nums">{formatDate(p.assessedOn)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.billNo}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(p.dueDate)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.accountNo}</TableCell>
                  <TableCell>{p.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CollectionsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CollectionsContent />
    </Suspense>
  );
}
