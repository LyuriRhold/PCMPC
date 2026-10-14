import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, monthEnd } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { monthChecklist, yearPeriods } from "@/modules/accounting/close";
import { CloseMonthButton, ReopenMonthForm, YearEndCloseButton } from "@/modules/accounting/ui/forms";

export const metadata: Metadata = { title: "Period close · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function CloseContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["gl.read", "gl.close", "gl.reopen"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const today = businessToday();
  const sp = z.object({ year: one }).parse(await searchParams);
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : Number(today.slice(0, 4));
  const data = await yearPeriods(year);
  const user = access.user;
  if (!data) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Period close</h1>
        <p className="text-sm text-muted-foreground">Fiscal year {year} isn&apos;t set up.</p>
      </div>
    );
  }
  // The checklist of each open month that is over (and of the current month, as a preview).
  const checks = await Promise.all(
    data.months.map(async (m) => {
      const end = monthEnd(`${m.year}-${String(m.month).padStart(2, "0")}-01`);
      const relevant = m.status === "OPEN" && `${m.year}-${String(m.month).padStart(2, "0")}-01` <= today;
      return { m, end, items: relevant ? await monthChecklist(m.year, m.month) : null };
    }),
  );
  const allButLastClosed = data.months.slice(0, -1).every((m) => m.status === "CLOSED");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Period close</h1>
          <p className="text-sm text-muted-foreground">
            A month closes when every item of its checklist passes; nothing dated in a closed month can be posted. Only the administrator reopens a month, with a reason. The year-end close moves the
            year&apos;s net surplus into Undivided Net Surplus and opens the next year.
          </p>
        </div>
        <form method="get" className="flex items-center gap-2 text-sm">
          <label htmlFor="year">Fiscal year</label>
          <input id="year" name="year" defaultValue={String(year)} className="h-8 w-20 rounded-md border px-2" />
          <button type="submit" className="underline underline-offset-4">
            Show
          </button>
        </form>
      </div>
      <p className="text-sm">
        Fiscal year {year} ({formatDate(data.fy.startDate)} to {formatDate(data.fy.endDate)}): <Badge variant="outline">{data.fy.status}</Badge>
        {data.closing ? ` · closed with a net surplus of ${format(data.closing.netSurplus)}` : ""}
      </p>
      {data.fy.status === "OPEN" && allButLastClosed && can(user, "gl.close") ? <YearEndCloseButton year={year} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {checks.map(({ m, end, items }) => {
          const label = `${MONTHS[m.month - 1]} ${m.year}`;
          return (
            <Card key={m.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  {label}
                  <Badge variant={m.status === "CLOSED" ? "secondary" : "outline"}>{m.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {items ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {items.map((i) => (
                      <li key={i.key} className="flex items-start gap-2">
                        <span className={i.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}>{i.ok ? "✓" : "✗"}</span>
                        <span>
                          {i.label}
                          <span className="block text-xs text-muted-foreground">{i.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : m.status === "CLOSED" ? (
                  <p className="text-sm text-muted-foreground">Closed{m.closedAt ? ` on ${formatDate(m.closedAt.toISOString().slice(0, 10))}` : ""}.</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not started.</p>
                )}
                {m.status === "OPEN" && end < today && items?.every((i) => i.ok) && can(user, "gl.close") && !(m.month === data.months.at(-1)?.month && m.year === data.months.at(-1)?.year) ? (
                  <CloseMonthButton year={m.year} month={m.month} label={label} />
                ) : null}
                {m.status === "CLOSED" && data.fy.status === "OPEN" && can(user, "gl.reopen") ? <ReopenMonthForm year={m.year} month={m.month} /> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function ClosePage(props: PageProps<"/accounting/close">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CloseContent searchParams={props.searchParams} />
    </Suspense>
  );
}
