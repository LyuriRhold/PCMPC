import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { listPos } from "@/modules/store/purchasing";
import { PO_STATUSES } from "@/modules/store/schema";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Purchasing · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function PurchasingContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { status } = z.object({ status: one.pipe(z.enum(PO_STATUSES).optional().catch(undefined)) }).parse(await searchParams);
  const rows = await listPos({ status });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Purchasing</h1>
          <p className="text-sm text-muted-foreground">The store clerk prepares purchase orders; the manager approves them; deliveries are received against them.</p>
        </div>
        {can(access.user, "store.receive") ? (
          <Button nativeButton={false} render={<Link href="/store/purchasing/orders/new" />}>
            New purchase order
          </Button>
        ) : null}
      </div>
      <StoreTabs section="purchasing" current="/store/purchasing" />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/store/purchasing" className={status ? "underline underline-offset-4" : "font-medium"}>
          All
        </Link>
        {PO_STATUSES.map((s) => (
          <Link key={s} href={`/store/purchasing?status=${s}`} className={status === s ? "font-medium" : "underline underline-offset-4"}>
            {s}
          </Link>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PO no.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No purchase orders.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ po, supplier }) => (
            <TableRow key={po.id}>
              <TableCell>
                <Link href={`/store/purchasing/orders/${po.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {po.poNo}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(po.poDate)}</TableCell>
              <TableCell>{supplier}</TableCell>
              <TableCell className="text-right tabular-nums">{format(po.total)}</TableCell>
              <TableCell>
                <Badge variant="outline">{po.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PurchasingPage(props: PageProps<"/store/purchasing">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PurchasingContent searchParams={props.searchParams} />
    </Suspense>
  );
}
