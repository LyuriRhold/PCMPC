import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { selectClass } from "@/modules/members/ui/member-form";
import { TD_STATUSES } from "@/modules/savings/schema";
import { timeDepositRegistry } from "@/modules/savings/service";
import { pct } from "@/modules/savings/ui/savings-panel";

export const metadata: Metadata = { title: "Time deposits · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const LABEL: Record<string, string> = { ACTIVE: "Active", MATURED: "Matured", PRETERMINATED: "Pre-terminated", ROLLED_OVER: "Rolled over" };

async function TimeDepositsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("savings.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = z.object({ status: one.pipe(z.enum(TD_STATUSES).optional().catch(undefined)) }).parse(await searchParams);
  const status = f.status ?? "ACTIVE";
  const rows = await timeDepositRegistry({ status });
  const today = businessToday();
  const soon = addDays(today, 7);
  const total = rows.reduce((s, r) => s + r.td.principal, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Time deposits</h1>
        <p className="text-sm text-muted-foreground">
          Certificates by maturity. Place, mature, roll over or pre-terminate a time deposit on the member&apos;s Savings tab; the money moves to and from the member&apos;s savings account.
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={status} className={selectClass}>
            {TD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {rows.length} certificate{rows.length === 1 ? "" : "s"} · principal {format(total)}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Certificate</TableHead>
            <TableHead>Member</TableHead>
            <TableHead className="text-right">Principal</TableHead>
            <TableHead>Rate · term</TableHead>
            <TableHead>Placed</TableHead>
            <TableHead>Matures</TableHead>
            <TableHead className="text-right">Interest paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No time deposits.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((r) => (
            <TableRow key={r.td.id}>
              <TableCell className="font-mono text-xs">{r.td.certificateNo}</TableCell>
              <TableCell>
                <Link href={`/members/${r.memberId}?tab=savings`} className="font-medium underline-offset-4 hover:underline">
                  {r.lastName}, {r.firstName}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.memberNo}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(r.td.principal)}</TableCell>
              <TableCell>
                {pct(r.td.ratePa)}% · {r.td.termDays} days
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(r.td.placementDate)}</TableCell>
              <TableCell className="tabular-nums">
                {formatDate(r.td.maturityDate)}
                {r.td.status === "ACTIVE" && r.td.maturityDate <= today ? <span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">due</span> : null}
                {r.td.status === "ACTIVE" && r.td.maturityDate > today && r.td.maturityDate <= soon ? <span className="ml-2 text-xs text-muted-foreground">this week</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.td.status === "ACTIVE" ? "" : format(r.td.interestPaid)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function TimeDepositsPage(props: PageProps<"/savings/time-deposits">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <TimeDepositsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
