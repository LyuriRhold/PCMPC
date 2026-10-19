import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { reportDef, runReport, type Cell, type ColumnKind } from "@/modules/reports/operational";

export const metadata: Metadata = { title: "Report · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

function show(v: Cell | undefined, kind: ColumnKind): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return format(v);
  if (kind === "date" && typeof v === "string" && isBusinessDate(v)) return formatDate(v);
  return String(v);
}

async function ReportContent(props: PageProps<"/reports/operational/[key]">) {
  const access = await guardPage("reports.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { key } = await props.params;
  const def = reportDef(key);
  if (!def) notFound();
  const sp = z.object({ from: one, to: one, asOf: one }).parse(await props.searchParams);
  const today = businessToday();
  const pick = (v: string | undefined, fallback: string) => (v && isBusinessDate(v) ? v : fallback);
  const to = pick(sp.to, today);
  const from = pick(sp.from, `${today.slice(0, 7)}-01`);
  const params = { from: from <= to ? from : to, to, asOf: pick(sp.asOf, today) };
  const result = await runReport(key, params, { canSeeSensitive: can(access.user, "members.read_sensitive") });
  const query = new URLSearchParams(def.params === "range" ? { from: params.from, to: params.to } : def.params === "asOf" ? { asOf: params.asOf } : {}).toString();
  const right = (kind: ColumnKind) => (kind === "money" || kind === "count" ? "text-right tabular-nums" : "");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/reports/operational" className="underline underline-offset-4">
              Reports
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{result.title}</h1>
          <p className="text-sm text-muted-foreground">{def.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {def.params !== "none" ? (
            <form method="get" className="flex flex-wrap items-center gap-2">
              {def.params === "range" ? (
                <>
                  <label htmlFor="from">From</label>
                  <input id="from" name="from" type="date" defaultValue={params.from} className="h-8 rounded-md border bg-background px-2" />
                  <label htmlFor="to">to</label>
                  <input id="to" name="to" type="date" defaultValue={params.to} className="h-8 rounded-md border bg-background px-2" />
                </>
              ) : (
                <>
                  <label htmlFor="asOf">As of</label>
                  <input id="asOf" name="asOf" type="date" defaultValue={params.asOf} className="h-8 rounded-md border bg-background px-2" />
                </>
              )}
              <button type="submit" className="underline underline-offset-4">
                Show
              </button>
            </form>
          ) : null}
          <a href={`/api/reports/operational/${key}${query ? `?${query}` : ""}`} className="underline underline-offset-4">
            Excel (.xlsx)
          </a>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c.key} className={right(c.kind)}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={result.columns.length} className="text-center text-sm text-muted-foreground">
                Nothing to show.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
                <TableCell key={c.key} className={right(c.kind)}>
                  {show(row[c.key], c.kind)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {result.totals ? (
          <TableFooter>
            <TableRow>
              {result.columns.map((c) => (
                <TableCell key={c.key} className={right(c.kind)}>
                  {show(result.totals?.[c.key], c.kind)}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
      {result.reconciliation.length ? (
        <div className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold">Reconciliation with the books</h2>
          {result.reconciliation.map((r) => (
            <p key={r.label} className={r.difference === 0n ? "text-muted-foreground" : "text-destructive"}>
              {r.label}: GL {format(r.gl)} · this report {format(r.subsidiary)} · difference {format(r.difference)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ReportPage(props: PageProps<"/reports/operational/[key]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReportContent {...props} />
    </Suspense>
  );
}
