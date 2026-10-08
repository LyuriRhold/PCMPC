import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import "@/modules/cashiering/builtins";
import { cashPosition } from "@/modules/cashiering/cash-position";

export const metadata: Metadata = { title: "Daily cash position · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const schema = z.object({ date: one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined)) });

async function PositionContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["cash.verify", "gl.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = schema.parse(await searchParams);
  const date = f.date ?? businessToday();
  const p = await cashPosition(date);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Daily cash position</h1>
        <p className="text-sm text-muted-foreground">Cash on Hand for {formatDate(date)}, from the counter&apos;s receipts and cash-outs, checked against the GL.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" defaultValue={date} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
        <a className="text-sm underline underline-offset-4" href={`/api/reports/cash-position?date=${date}`}>
          Download Excel
        </a>
      </form>
      <Table>
        <TableBody>
          <TableRow className="font-medium">
            <TableCell>Beginning cash on hand</TableCell>
            <TableCell className="text-right tabular-nums">{format(p.beginning)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={2} className="pt-4 text-xs font-semibold uppercase text-muted-foreground">
              Add: receipts (cash and checks)
            </TableCell>
          </TableRow>
          {p.receipts.map((r) => (
            <TableRow key={r.type}>
              <TableCell className="pl-6">
                {r.label} <span className="text-xs text-muted-foreground">({r.count} receipt{r.count === 1 ? "" : "s"})</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(r.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="pl-6 font-medium">Total receipts</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{format(p.totalIn)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={2} className="pt-4 text-xs font-semibold uppercase text-muted-foreground">
              Less: cash-outs
            </TableCell>
          </TableRow>
          {p.cashOuts.map((o) => (
            <TableRow key={o.type}>
              <TableCell className="pl-6">
                {o.label} <span className="text-xs text-muted-foreground">({o.count})</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">({format(o.amount)})</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="pl-6 font-medium">Total cash-outs</TableCell>
            <TableCell className="text-right font-medium tabular-nums">({format(p.totalOut)})</TableCell>
          </TableRow>
          {p.other.length ? (
            <>
              <TableRow>
                <TableCell colSpan={2} className="pt-4 text-xs font-semibold uppercase text-muted-foreground">
                  Other postings to Cash on Hand
                </TableCell>
              </TableRow>
              {p.other.map((o) => (
                <TableRow key={o.jeId}>
                  <TableCell className="pl-6">
                    <Link className="font-mono text-xs hover:underline" href={`/accounting/journals/${o.jeId}`}>
                      {o.jeNo}
                    </Link>{" "}
                    {o.particulars}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(o.amount)}</TableCell>
                </TableRow>
              ))}
            </>
          ) : null}
          <TableRow className="border-t-2 font-semibold">
            <TableCell>Ending cash on hand</TableCell>
            <TableCell className="text-right tabular-nums" data-testid="ending">
              {format(p.ending)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>GL Cash on Hand balance</TableCell>
            <TableCell className="text-right tabular-nums">{format(p.gl)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className={cn("text-sm font-medium", p.reconciled ? "text-green-700" : "text-destructive")} data-testid="reconciled">
        {p.reconciled ? "Agrees with the general ledger." : `Does not agree with the GL (difference ${format(p.gl - p.ending)}).`}
      </p>
    </div>
  );
}

export default function CashPositionPage(props: PageProps<"/cashiering/cash-position">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PositionContent searchParams={props.searchParams} />
    </Suspense>
  );
}
