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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { REPORTS, reportDef, reportParams, type Cell, type Kind, type Param } from "@/modules/water/report-tables";
import { productionReadings } from "@/modules/water/reports";
import { ProductionReadingForm } from "@/modules/water/ui/collection-forms";
import { WATER_REPORT_VIEWERS } from "@/modules/water/ui/report-access";
import { Tiles } from "@/modules/water/ui/tiles";

export const metadata: Metadata = { title: "Water reports · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

function show(v: Cell | undefined, kind: Kind): string {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "money" && typeof v === "bigint") return format(v);
  if (kind === "pct") return `${v}%`;
  if (kind === "date" && typeof v === "string") return formatDate(v);
  if (kind === "int" && typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

const PARAM_INPUT: Record<Param, { label: string; type: string }> = {
  period: { label: "Billing period (YYYY-MM)", type: "month" },
  month: { label: "Month due (YYYY-MM)", type: "month" },
  date: { label: "Date", type: "date" },
  asOf: { label: "As of", type: "date" },
  from: { label: "From", type: "date" },
  to: { label: "To", type: "date" },
  customer: { label: "Customer", type: "hidden" },
};

async function ReportsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(WATER_REPORT_VIEWERS);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = await searchParams;
  const key = one.parse(sp.report) ?? "billing-summary";
  const def = reportDef(key) ?? REPORTS[0]!;
  const params = reportParams((k) => one.parse(sp[k]));
  const needsCustomer = def.params.includes("customer") && !z.uuid().safeParse(params.customer).success;
  const table = needsCustomer ? null : await def.build(params);
  const query = new URLSearchParams(Object.fromEntries(def.params.map((p) => [p, params[p]])));
  const production = def.key === "nrw" ? await productionReadings() : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">Water reports</h1>
        <p className="text-sm text-muted-foreground">Choose a report, set its dates, then print it or download it as Excel.</p>
      </div>
      <Tiles />

      <nav className="flex flex-wrap gap-2 print:hidden" aria-label="Reports">
        {REPORTS.filter((r) => r.key !== "soa").map((r) => (
          <Link key={r.key} href={`/water/reports?report=${r.key}`} className={`rounded-md border px-2.5 py-1 text-sm ${r.key === def.key ? "bg-muted font-medium" : "hover:bg-muted"}`}>
            {r.title}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3 print:hidden">
        <input type="hidden" name="report" value={def.key} />
        {def.params.map((p) =>
          PARAM_INPUT[p].type === "hidden" ? (
            <input key={p} type="hidden" name={p} value={params[p]} />
          ) : (
            <div key={p} className="flex flex-col gap-1.5">
              <Label htmlFor={p}>{PARAM_INPUT[p].label}</Label>
              <Input id={p} name={p} type={PARAM_INPUT[p].type} defaultValue={params[p]} className="w-44" />
            </div>
          ),
        )}
        {def.params.some((p) => PARAM_INPUT[p].type !== "hidden") ? (
          <Button type="submit" size="sm">
            Show
          </Button>
        ) : null}
        {table ? (
          <>
            <PrintButton />
            <a href={`/api/water/reports/${def.key}?${query.toString()}`} className="text-sm underline underline-offset-4">
              Download Excel
            </a>
          </>
        ) : null}
      </form>

      {needsCustomer ? <p className="text-sm text-muted-foreground">Open a customer and choose &quot;Statement of account&quot;.</p> : null}
      {table ? (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-semibold">{table.title}</h2>
            <p className="text-sm text-muted-foreground">{table.subtitle}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((c) => (
                  <TableHead key={c.key} className={c.kind === "text" || c.kind === "date" ? "" : "text-right"}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.columns.length} className="text-center text-sm text-muted-foreground">
                    Nothing to show.
                  </TableCell>
                </TableRow>
              ) : null}
              {table.rows.map((r, i) => (
                <TableRow key={i}>
                  {table.columns.map((c) => (
                    <TableCell key={c.key} className={c.kind === "text" || c.kind === "date" ? "" : "text-right tabular-nums"}>
                      {show(r[c.key], c.kind)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            {table.footer ? (
              <TableFooter>
                <TableRow>
                  {table.columns.map((c) => (
                    <TableCell key={c.key} className={c.kind === "text" || c.kind === "date" ? "font-medium" : "text-right font-medium tabular-nums"}>
                      {show(table.footer?.[c.key], c.kind === "date" ? "text" : c.kind)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </section>
      ) : null}

      {def.key === "nrw" ? (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Production meter readings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {can(access.user, "water.bill") ? <ProductionReadingForm today={businessToday()} /> : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Reading (m³)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {production.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.source}</TableCell>
                    <TableCell className="tabular-nums">{formatDate(p.readingDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.reading.toLocaleString("en-US")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function WaterReportsPage(props: PageProps<"/water/reports">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReportsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
