import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { listDvs } from "@/modules/cashiering/queries";
import { DV_STATUSES } from "@/modules/cashiering/schema";

export const metadata: Metadata = { title: "Disbursement vouchers · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const schema = z.object({ status: one.pipe(z.enum(DV_STATUSES).optional().catch(undefined)) });

async function DvListContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["cash.dv_prepare", "cash.dv_approve", "cash.session"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = schema.parse(await searchParams);
  const rows = await listDvs({ status: f.status });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Disbursement vouchers</h1>
          <p className="text-sm text-muted-foreground">Prepared → approved (by another user) → released at the counter.</p>
        </div>
        {can(access.user, "cash.dv_prepare") ? (
          <Button nativeButton={false} render={<Link href="/cashiering/vouchers/new" />}>
            New DV
          </Button>
        ) : null}
      </div>
      <nav aria-label="DV status" className="flex flex-wrap gap-1 border-b">
        {[undefined, ...DV_STATUSES].map((s) => (
          <Link
            key={s ?? "ALL"}
            href={s ? `/cashiering/vouchers?status=${s}` : "/cashiering/vouchers"}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", f.status === s ? "border-primary font-medium" : "border-transparent text-muted-foreground")}
          >
            {s ?? "All"}
          </Link>
        ))}
      </nav>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>DV no.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead>Particulars</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No disbursement vouchers.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-mono text-xs">
                <Link href={`/cashiering/vouchers/${d.id}`} className="hover:underline">
                  {d.dvNo}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(d.dvDate)}</TableCell>
              <TableCell>{d.payee}</TableCell>
              <TableCell>{d.particulars}</TableCell>
              <TableCell className="text-right tabular-nums">{format(d.amount)}</TableCell>
              <TableCell className="text-xs">{d.mode}</TableCell>
              <TableCell className="text-xs">{d.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DvListPage(props: PageProps<"/cashiering/vouchers">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <DvListContent searchParams={props.searchParams} />
    </Suspense>
  );
}
