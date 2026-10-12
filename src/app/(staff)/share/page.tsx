import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { MemberStatusBadge } from "@/modules/members/ui/status-badge";
import { shareRegistry, shareTotals } from "@/modules/share/service";

export const metadata: Metadata = { title: "Share capital · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const filterSchema = z.object({
  q: one,
  page: one.pipe(z.string().regex(/^\d{1,5}$/).transform(Number).optional().catch(undefined)),
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

async function ShareContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("share.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const [result, totals] = await Promise.all([shareRegistry({ q: f.q, page: f.page }), shareTotals()]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.q) q.set("q", f.q);
    q.set("page", String(p));
    return `/share?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Share capital &amp; CBU</h1>
        <p className="text-sm text-muted-foreground">
          Subscribed and paid-up capital per member. Open a member to subscribe, transfer or see the share ledger; payments are collected at the teller.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total subscribed" value={format(totals.subscribed)} />
        <Stat label="Total paid-up" value={format(totals.paidUp)} />
        <Stat label="Unpaid subscriptions" value={format(totals.unpaid)} />
        <Stat label="Members with paid-up capital" value={totals.holders.toLocaleString("en-US")} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search name or member no.</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="e.g. dela cruz, M-000001" />
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        <Link href="/share" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} member{result.total === 1 ? "" : "s"} · page {result.page} of {pages}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member no.</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Subscribed</TableHead>
            <TableHead className="text-right">Paid-up</TableHead>
            <TableHead className="text-right">Unpaid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No share capital records match.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.memberNo ?? "—"}</TableCell>
              <TableCell>
                <Link href={`/members/${r.id}?tab=share`} className="font-medium underline-offset-4 hover:underline">
                  {r.lastName}, {r.firstName}
                </Link>
              </TableCell>
              <TableCell>
                <MemberStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(r.subscribed)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(r.paidUp)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(r.unpaid)}</TableCell>
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

export default function SharePage(props: PageProps<"/share">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ShareContent searchParams={props.searchParams} />
    </Suspense>
  );
}
