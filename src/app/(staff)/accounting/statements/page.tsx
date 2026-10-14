import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addMonths,
  businessToday,
  formatDate,
  isBusinessDate,
} from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { can } from "@/lib/auth-guard";
import {
  cashFlows,
  changesInEquity,
  financialCondition,
  FsError,
  operations,
  type CashFlows,
  type ChangesInEquity,
  type FinancialCondition,
  type Operations,
} from "@/modules/accounting/statements";
import { fiscalYearStart } from "@/modules/ledger/periods";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "Financial statements · PCMPC MIS" };

const one = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.string().optional(),
);
const TABS = [
  { id: "position", label: "Financial condition" },
  { id: "operations", label: "Operations" },
  { id: "equity", label: "Changes in equity" },
  { id: "cashflows", label: "Cash flows" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const SECTION: Record<string, string> = {
  ASSETS: "Assets",
  LIABILITIES: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenues",
  EXPENSE: "Expenses",
  OPERATING: "Operating activities",
  INVESTING: "Investing activities",
  FINANCING: "Financing activities",
};

function Amount({ value }: { value: Money | undefined }) {
  return (
    <TableCell className="text-right tabular-nums">
      {value === undefined ? "" : format(value)}
    </TableCell>
  );
}
function TotalRow({
  label,
  values,
}: {
  label: string;
  values: Array<Money | undefined>;
}) {
  return (
    <TableRow className="font-semibold">
      <TableCell>{label}</TableCell>
      {values.map((v, i) => (
        <Amount key={i} value={v} />
      ))}
    </TableRow>
  );
}
function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <TableRow>
      <TableCell colSpan={span} className="pt-4 font-semibold">
        {label}
      </TableCell>
    </TableRow>
  );
}

async function StatementsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z
    .object({ tab: one, from: one, to: one, compare: one })
    .parse(await searchParams);
  const today = businessToday();
  const to = sp.to && isBusinessDate(sp.to) ? sp.to : today;
  const from =
    sp.from && isBusinessDate(sp.from) && sp.from <= to
      ? sp.from
      : await fiscalYearStart(to, getDb());
  const tab: Tab = TABS.some((t) => t.id === sp.tab)
    ? (sp.tab as Tab)
    : "position";
  const compare = sp.compare === "1";
  const prev = { from: addMonths(from, -12), to: addMonths(to, -12) };
  const href = (t: Tab) =>
    `/accounting/statements?${new URLSearchParams({ tab: t, from, to, ...(compare ? { compare: "1" } : {}) }).toString()}`;
  const exportHref = (f: "xlsx" | "pdf") =>
    `/api/reports/fs?${new URLSearchParams({ format: f, from, to }).toString()}`;

  // The statements are computed first; the page is built from them (or from the mapping error).
  const loaded: {
    sfc?: FinancialCondition;
    soo?: Operations;
    sce?: ChangesInEquity;
    cf?: CashFlows;
    error?: string;
  } = {};
  try {
    if (tab === "position")
      loaded.sfc = await financialCondition(
        to,
        compare ? { compareAsOf: prev.to } : {},
      );
    else if (tab === "operations")
      loaded.soo = await operations(from, to, compare ? { compare: prev } : {});
    else if (tab === "equity") loaded.sce = await changesInEquity(from, to);
    else
      loaded.cf = await cashFlows(from, to, compare ? { compare: prev } : {});
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    loaded.error = e.message;
  }
  const balanced: boolean | null = loaded.sfc
    ? loaded.sfc.totals.balanced
    : null;
  let body: React.ReactNode;
  if (loaded.error) {
    body = (
      <div className="rounded-lg border border-destructive p-4 text-sm">
        <p className="text-destructive">{loaded.error}</p>
        <Link
          href="/accounting/statements/mapping"
          className="underline underline-offset-4"
        >
          Open the account mapping
        </Link>
      </div>
    );
  } else {
    if (tab === "position") {
      const sfc = loaded.sfc!;
      const cols = compare ? 3 : 2;
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>As of {formatDate(to)}</TableHead>
              <TableHead className="text-right">{formatDate(to)}</TableHead>
              {compare ? (
                <TableHead className="text-right">
                  {formatDate(prev.to)}
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(["ASSETS", "LIABILITIES", "EQUITY"] as const).map((section) => (
              <SectionRows key={section} label={SECTION[section]!} span={cols}>
                {sfc.lines
                  .filter((l) => l.section === section)
                  .map((l) => (
                    <TableRow key={l.code}>
                      <TableCell className="pl-6">{l.caption}</TableCell>
                      <Amount value={l.amount} />
                      {compare ? <Amount value={l.compare} /> : null}
                    </TableRow>
                  ))}
                <TotalRow
                  label={
                    section === "ASSETS"
                      ? "Total assets"
                      : section === "LIABILITIES"
                        ? "Total liabilities"
                        : "Total equity"
                  }
                  values={[
                    section === "ASSETS"
                      ? sfc.totals.assets
                      : section === "LIABILITIES"
                        ? sfc.totals.liabilities
                        : sfc.totals.equity,
                    ...(compare
                      ? [
                          section === "ASSETS"
                            ? sfc.compareTotals?.assets
                            : section === "LIABILITIES"
                              ? sfc.compareTotals?.liabilities
                              : sfc.compareTotals?.equity,
                        ]
                      : []),
                  ]}
                />
              </SectionRows>
            ))}
            <TotalRow
              label="Total liabilities and equity"
              values={[
                sfc.totals.liabilitiesAndEquity,
                ...(compare ? [sfc.compareTotals?.liabilitiesAndEquity] : []),
              ]}
            />
          </TableBody>
        </Table>
      );
    } else if (tab === "operations") {
      const soo = loaded.soo!;
      const cols = 2 + soo.segments.length + (compare ? 1 : 0);
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {formatDate(from)} to {formatDate(to)}
              </TableHead>
              <TableHead className="text-right">Total</TableHead>
              {soo.segments.map((s) => (
                <TableHead key={s.code} className="text-right">
                  {s.name}
                </TableHead>
              ))}
              {compare ? (
                <TableHead className="text-right">Last year</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(["REVENUE", "EXPENSE"] as const).map((section) => (
              <SectionRows key={section} label={SECTION[section]!} span={cols}>
                {soo.lines
                  .filter((l) => l.section === section)
                  .map((l) => (
                    <TableRow key={l.code}>
                      <TableCell className="pl-6">{l.caption}</TableCell>
                      <Amount value={l.amount} />
                      {soo.segments.map((s) => (
                        <Amount key={s.code} value={l.bySegment?.[s.code]} />
                      ))}
                      {compare ? <Amount value={l.compare} /> : null}
                    </TableRow>
                  ))}
                <TotalRow
                  label={
                    section === "REVENUE" ? "Total revenues" : "Total expenses"
                  }
                  values={[
                    section === "REVENUE"
                      ? soo.totals.revenues
                      : soo.totals.expenses,
                    ...soo.segments.map((s) =>
                      section === "REVENUE"
                        ? soo.segmentTotals[s.code]?.revenues
                        : soo.segmentTotals[s.code]?.expenses,
                    ),
                    ...(compare
                      ? [
                          section === "REVENUE"
                            ? soo.compareTotals?.revenues
                            : soo.compareTotals?.expenses,
                        ]
                      : []),
                  ]}
                />
              </SectionRows>
            ))}
            <TotalRow
              label="Net surplus"
              values={[
                soo.totals.netSurplus,
                ...soo.segments.map(
                  (s) => soo.segmentTotals[s.code]?.netSurplus,
                ),
                ...(compare ? [soo.compareTotals?.netSurplus] : []),
              ]}
            />
          </TableBody>
        </Table>
      );
    } else if (tab === "equity") {
      const sce = loaded.sce!;
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {formatDate(from)} to {formatDate(to)}
              </TableHead>
              <TableHead className="text-right">Beginning</TableHead>
              <TableHead className="text-right">Net surplus</TableHead>
              <TableHead className="text-right">Year-end transfers</TableHead>
              <TableHead className="text-right">Other changes</TableHead>
              <TableHead className="text-right">End</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sce.rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell>{r.caption}</TableCell>
                <Amount value={r.opening} />
                <Amount value={r.netSurplus} />
                <Amount value={r.transfers} />
                <Amount value={r.other} />
                <Amount value={r.closing} />
              </TableRow>
            ))}
            <TotalRow
              label="Total equity"
              values={[
                sce.total.opening,
                sce.total.netSurplus,
                sce.total.transfers,
                sce.total.other,
                sce.total.closing,
              ]}
            />
          </TableBody>
        </Table>
      );
    } else {
      const cf = loaded.cf!;
      const cols = compare ? 3 : 2;
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {formatDate(from)} to {formatDate(to)} (indirect method)
              </TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {compare ? (
                <TableHead className="text-right">Last year</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(["OPERATING", "INVESTING", "FINANCING"] as const).map((a) => (
              <SectionRows key={a} label={SECTION[a]!} span={cols}>
                {cf.lines
                  .filter((l) => l.activity === a)
                  .map((l) => (
                    <TableRow key={l.code}>
                      <TableCell className="pl-6">{l.caption}</TableCell>
                      <Amount value={l.amount} />
                      {compare ? <Amount value={l.compare} /> : null}
                    </TableRow>
                  ))}
                <TotalRow
                  label={`Net cash from ${SECTION[a]!.toLowerCase()}`}
                  values={[
                    a === "OPERATING"
                      ? cf.totals.operating
                      : a === "INVESTING"
                        ? cf.totals.investing
                        : cf.totals.financing,
                    ...(compare
                      ? [
                          a === "OPERATING"
                            ? cf.compareTotals?.operating
                            : a === "INVESTING"
                              ? cf.compareTotals?.investing
                              : cf.compareTotals?.financing,
                        ]
                      : []),
                  ]}
                />
              </SectionRows>
            ))}
            <TotalRow
              label="Net change in cash"
              values={[
                cf.totals.netChange,
                ...(compare ? [cf.compareTotals?.netChange] : []),
              ]}
            />
            <TotalRow
              label="Cash at the beginning"
              values={[
                cf.totals.beginningCash,
                ...(compare ? [cf.compareTotals?.beginningCash] : []),
              ]}
            />
            <TotalRow
              label="Cash at the end"
              values={[
                cf.totals.endingCash,
                ...(compare ? [cf.compareTotals?.endingCash] : []),
              ]}
            />
          </TableBody>
        </Table>
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Financial statements</h1>
          <p className="text-sm text-muted-foreground">
            Straight from the general ledger through the statement lines each
            account is mapped to (PFRF for Cooperatives layout, to be confirmed
            with the auditor).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {balanced !== null ? (
            <Badge
              variant={balanced ? "outline" : "destructive"}
              data-testid="fs-balanced"
            >
              {balanced ? "Balanced" : "Not balanced"}
            </Badge>
          ) : null}
          <a href={exportHref("xlsx")} className="underline underline-offset-4">
            Excel (.xlsx)
          </a>
          <a href={exportHref("pdf")} className="underline underline-offset-4">
            PDF
          </a>
          {can(access.user, "gl.coa") ? (
            <Link
              href="/accounting/statements/mapping"
              className="underline underline-offset-4"
            >
              Account mapping
            </Link>
          ) : null}
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To (as of)</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="compare"
            value="1"
            defaultChecked={compare}
          />{" "}
          Compare with a year earlier
        </label>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <nav
        role="tablist"
        aria-label="Statements"
        className="flex flex-wrap gap-1 border-b"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href(t.id)}
            role="tab"
            aria-selected={t.id === tab}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${t.id === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

function SectionRows({
  label,
  span,
  children,
}: {
  label: string;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <SectionRow label={label} span={span} />
      {children}
    </>
  );
}

export default function StatementsPage(
  props: PageProps<"/accounting/statements">,
) {
  return (
    <Suspense fallback={<PageLoading />}>
      <StatementsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
