import type { Metadata } from "next";
import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { addDays, businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { fiscalYears } from "@/modules/ledger/schema";
import { caprData, templateStatus } from "@/modules/reports/cda";
import { recentRuns } from "@/modules/reports/service";

export const metadata: Metadata = { title: "CDA reports · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function CdaContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("reports.cda");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const years = await getDb().select().from(fiscalYears).orderBy(asc(fiscalYears.year));
  const sp = z.object({ year: one }).parse(await searchParams);
  const thisYear = Number(businessToday().slice(0, 4));
  const fallback = years.some((y) => y.year === thisYear - 1) ? thisYear - 1 : thisYear;
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : fallback;
  const fy = years.find((y) => y.year === year);
  const [data, templates, runs] = [await caprData(year), templateStatus(), await recentRuns("CAPR")];
  const sections = [...new Set(data.map((d) => d.section))];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CDA reports</h1>
          <p className="text-sm text-muted-foreground">
            The figures the MIS gives the CDA annual report (CAPR) and its attachments, from the books and the member records.
            {fy ? ` Due to the CDA by ${formatDate(addDays(fy.endDate, 120))} (120 days after the fiscal year ends).` : ""}
          </p>
        </div>
        <form method="get" className="flex items-center gap-2 text-sm">
          <label htmlFor="year">Fiscal year</label>
          <select id="year" name="year" defaultValue={String(year)} className="h-8 rounded-md border bg-background px-2">
            {(years.length ? years.map((y) => y.year) : [thisYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="submit" className="underline underline-offset-4">
            Show
          </button>
        </form>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Download</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <a href={`/api/reports/cda?year=${year}`} className="underline underline-offset-4">
            CAPR workbook {year} (.xlsx)
          </a>
          <p className="text-muted-foreground">An editable workbook: the CDA template filled where it is mapped, the data sheets, the officers and trainings, and the fields the MIS has no data for.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CDA template</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.key}>
                  <TableCell>{t.title}</TableCell>
                  <TableCell className="font-mono text-xs">{t.file}</TableCell>
                  <TableCell>
                    {t.found ? <Badge variant="secondary">{`Found · ${t.mapped} field(s) mapped`}</Badge> : <Badge variant="outline">Not provided yet: the data sheets are used</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <Card key={section}>
            <CardHeader>
              <CardTitle className="text-base">{section}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {data
                    .filter((d) => d.section === section)
                    .map((d) => (
                      <TableRow key={d.key}>
                        <TableCell>{d.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{typeof d.value === "bigint" ? format(d.value) : d.value}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Generated</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  Not generated yet.
                </TableCell>
              </TableRow>
            ) : null}
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.at)}</TableCell>
                <TableCell>{String(r.params.year ?? "")}</TableCell>
                <TableCell>{r.username ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function CdaPage(props: PageProps<"/reports/cda">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CdaContent searchParams={props.searchParams} />
    </Suspense>
  );
}
