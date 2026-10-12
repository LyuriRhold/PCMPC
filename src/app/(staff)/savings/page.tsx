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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { selectClass } from "@/modules/members/ui/member-form";
import { DEPOSIT_ACCOUNT_STATUSES } from "@/modules/savings/schema";
import { accountRegistry } from "@/modules/savings/service";

export const metadata: Metadata = { title: "Savings accounts · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({
  q: one,
  status: one.pipe(z.enum(DEPOSIT_ACCOUNT_STATUSES).optional().catch(undefined)),
  page: one.pipe(z.string().regex(/^\d{1,5}$/).transform(Number).optional().catch(undefined)),
});

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{href ? <Link href={href} className="underline-offset-4 hover:underline">{value}</Link> : value}</p>
    </div>
  );
}

async function SavingsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("savings.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const result = await accountRegistry({ q: f.q, status: f.status, page: f.page });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.q) q.set("q", f.q);
    if (f.status) q.set("status", f.status);
    q.set("page", String(p));
    return `/savings?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Savings accounts</h1>
          <p className="text-sm text-muted-foreground">Savings and time-deposit accounts. Open a member to open an account, place a time deposit or see the passbook; deposits are made at the teller.</p>
        </div>
        <Link href="/savings/products" className="text-sm underline underline-offset-4">
          Savings products (rates and limits)
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total savings deposits" value={format(result.totals.savings)} />
        <Stat label="Total time deposits" value={format(result.totals.time)} />
        <Stat label="Dormant accounts" value={result.totals.dormant.toLocaleString("en-US")} href="/savings?status=DORMANT" />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search name, member no. or account no.</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="e.g. dela cruz, SA-000001" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className={selectClass}>
            <option value="">All</option>
            {DEPOSIT_ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        <Link href="/savings" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} account{result.total === 1 ? "" : "s"} · page {result.page} of {pages}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account no.</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last deposit/withdrawal</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No accounts match.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((r) => (
            <TableRow key={r.account.id}>
              <TableCell className="font-mono text-xs">{r.account.accountNo}</TableCell>
              <TableCell>
                <Link href={`/members/${r.account.memberId}?tab=savings`} className="font-medium underline-offset-4 hover:underline">
                  {r.lastName}, {r.firstName}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.memberNo}</span>
              </TableCell>
              <TableCell>{r.productName}</TableCell>
              <TableCell>
                <Badge variant={r.account.status === "OPEN" ? "default" : "outline"}>{r.account.status}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">{r.account.lastCustomerTxnAt ? formatDate(r.account.lastCustomerTxnAt) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{format(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <div className="flex items-center gap-3 text-sm">
          {result.page > 1 ? (
            <Link href={href(result.page - 1)} className="underline underline-offset-4">
              ← Previous
            </Link>
          ) : null}
          {result.page < pages ? (
            <Link href={href(result.page + 1)} className="underline underline-offset-4">
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function SavingsPage(props: PageProps<"/savings">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SavingsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
