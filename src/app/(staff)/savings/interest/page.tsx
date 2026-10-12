import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, formatDateTime, type BusinessDate } from "@/lib/dates";
import { hasRun } from "@/lib/jobs";
import { format } from "@/lib/money";
import { getDb } from "@/db/client";
import { guardPage } from "@/lib/page-guard";
import { selectClass } from "@/modules/members/ui/member-form";
import { quarterEnding } from "@/modules/savings/interest";
import { interestRuns, listProducts, previewInterest } from "@/modules/savings/service";
import { PostInterestButton } from "@/modules/savings/ui/savings-forms";
import { pct } from "@/modules/savings/ui/savings-panel";

export const metadata: Metadata = { title: "Interest runs · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

/** The last `n` quarter ends before today, newest first. */
function recentQuarterEnds(today: BusinessDate, n: number): BusinessDate[] {
  const out: BusinessDate[] = [];
  let year = Number(today.slice(0, 4));
  const ends = ["12-31", "09-30", "06-30", "03-31"];
  while (out.length < n) {
    for (const md of ends) {
      const d = `${year}-${md}`;
      if (d < today && out.length < n) out.push(d);
    }
    year -= 1;
  }
  return out;
}

async function InterestContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("savings.run_interest");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z.object({ product: one, periodEnd: one }).parse(await searchParams);
  const today = businessToday();
  const products = (await listProducts()).filter((p) => p.kind === "SAVINGS");
  const quarterEnds = recentQuarterEnds(today, 8);
  const product = products.find((p) => p.id === sp.product) ?? products[0];
  const periodEnd = quarterEnds.find((d) => d === sp.periodEnd) ?? quarterEnds[0];
  const [lines, done, runs] = product && periodEnd ? await Promise.all([previewInterest(product.id, periodEnd), hasRun(getDb(), "savings-interest", `${product.code}:${periodEnd}`), interestRuns()]) : [[], false, await interestRuns()];
  const earning = lines.filter((l) => l.interest > 0n);
  const total = earning.reduce((s, l) => s + l.interest, 0n);
  const wtax = earning.reduce((s, l) => s + l.wtax, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Savings interest runs</h1>
        <p className="text-sm text-muted-foreground">
          Interest is credited every quarter on the average daily balance (actual days ÷ 365). Preview a quarter, then post it once: one journal entry for all accounts.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product">Product</Label>
          <select id="product" name="product" defaultValue={product?.id} className={selectClass}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({pct(p.ratePa)}%)
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="periodEnd">Quarter ending</Label>
          <select id="periodEnd" name="periodEnd" defaultValue={periodEnd} className={selectClass}>
            {quarterEnds.map((d) => (
              <option key={d} value={d}>
                {formatDate(d)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Preview
        </Button>
      </form>

      {product && periodEnd ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {product.name} · {formatDate(quarterEnding(periodEnd)?.start ?? periodEnd)} to {formatDate(periodEnd)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm">
              {earning.length} of {lines.length} account(s) earn · interest {format(total)} · withholding tax {format(wtax)} · credited {format(total - wtax)}
              {product.minBalanceEarn > 0n ? ` · no interest below an average balance of ${format(product.minBalanceEarn)}` : ""}
            </p>
            {done ? (
              <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
                Already posted for this quarter.
              </p>
            ) : lines.length > 0 ? (
              <PostInterestButton productId={product.id} periodEnd={periodEnd} total={String(total)} />
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Average daily balance</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Withholding tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No accounts for this quarter.
                    </TableCell>
                  </TableRow>
                ) : null}
                {lines.map((l) => (
                  <TableRow key={l.accountId}>
                    <TableCell className="font-mono text-xs">{l.accountNo}</TableCell>
                    <TableCell>
                      {l.memberName} <span className="font-mono text-xs text-muted-foreground">{l.memberNo}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{format(l.adb)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(l.interest)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(l.wtax)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Posted runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product · quarter end</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Accounts</TableHead>
                <TableHead className="text-right">Interest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No interest runs yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {runs.map((r) => {
                const [code, end] = r.key.split(":");
                const result = r.result as { accounts?: number; total?: string } | null;
                return (
                  <TableRow key={r.key}>
                    <TableCell>
                      {code} · {end ? formatDate(end) : ""}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDateTime(r.runAt)}</TableCell>
                    <TableCell>{r.by ?? "system"}</TableCell>
                    <TableCell className="text-right tabular-nums">{result?.accounts ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(BigInt(result?.total ?? "0"))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InterestRunsPage(props: PageProps<"/savings/interest">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <InterestContent searchParams={props.searchParams} />
    </Suspense>
  );
}
