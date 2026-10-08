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
import { can } from "@/lib/auth-guard";
import { formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { listEntries } from "@/modules/ledger/queries";
import { BOOKS, JE_STATUSES } from "@/modules/ledger/schema";
import { JeStatusBadge } from "@/modules/ledger/ui/je-status-badge";

export const metadata: Metadata = { title: "Journal vouchers · PCMPC MIS" };

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const date = one.pipe(z.string().refine(isBusinessDate).optional().catch(undefined));
const filterSchema = z.object({
  status: one.pipe(z.enum(JE_STATUSES).optional().catch(undefined)),
  book: one.pipe(z.enum(BOOKS).optional().catch(undefined)),
  from: date,
  to: date,
  q: one,
  page: one.pipe(z.string().regex(/^\d{1,5}$/).transform(Number).optional().catch(undefined)),
});

async function JournalsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = filterSchema.parse(await searchParams);
  const result = await listEntries(f);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && k !== "page") q.set(k, String(v));
    q.set("page", String(p));
    return `/accounting/journals?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Journal vouchers</h1>
          <p className="text-sm text-muted-foreground">Every journal entry: manual JVs and module postings.</p>
        </div>
        {can(access.user, "gl.jv_prepare") ? (
          <Button nativeButton={false} render={<Link href="/accounting/journals/new" />}>
            New journal voucher
          </Button>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="JE no., particulars or reference" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className={selectClass}>
            <option value="">All</option>
            {JE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="book">Book</Label>
          <select id="book" name="book" defaultValue={f.book ?? ""} className={selectClass}>
            <option value="">All</option>
            {BOOKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to ?? ""} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          Filter
        </Button>
        <Link href="/accounting/journals" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>JE no.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Particulars</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prepared / approved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No journal entries.
              </TableCell>
            </TableRow>
          ) : null}
          {result.rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-mono text-xs">{e.jeNo ?? "draft"}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(e.entryDate)}</TableCell>
              <TableCell>
                <Link href={`/accounting/journals/${e.id}`} className="underline-offset-4 hover:underline">
                  {e.particulars}
                </Link>
                {e.sourceModule !== "manual_jv" ? <span className="ml-2 text-xs text-muted-foreground">({e.sourceModule})</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(e.total)}</TableCell>
              <TableCell>
                <JeStatusBadge status={e.status} />
              </TableCell>
              <TableCell className="text-xs">
                {e.preparedBy ?? "system"}
                {e.approvedBy ? ` / ${e.approvedBy}` : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-3 text-sm">
        {result.page > 1 ? <Link href={href(result.page - 1)}>← Newer</Link> : null}
        {result.page < pages ? <Link href={href(result.page + 1)}>Older →</Link> : null}
      </div>
    </div>
  );
}

export default function JournalsPage(props: PageProps<"/accounting/journals">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <JournalsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
