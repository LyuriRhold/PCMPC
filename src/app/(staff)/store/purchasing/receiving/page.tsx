import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { listRrs, openPos } from "@/modules/store/purchasing";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Receiving · PCMPC MIS" };

async function ReceivingContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [rrs, pos] = await Promise.all([listRrs(), openPos()]);
  const canReceive = can(access.user, "store.receive");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Receiving</h1>
          <p className="text-sm text-muted-foreground">A receiving report posts the delivery into stock and what is owed the supplier. Receive against an approved purchase order where there is one.</p>
        </div>
        {canReceive ? (
          <Button variant="outline" nativeButton={false} render={<Link href="/store/purchasing/receiving/new" />}>
            Receive without a PO
          </Button>
        ) : null}
      </div>
      <StoreTabs section="purchasing" current="/store/purchasing/receiving" />

      {pos.length ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Approved orders still to come</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {pos.map(({ po, supplier }) => (
              <li key={po.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/store/purchasing/orders/${po.id}`} className="font-mono text-xs underline underline-offset-4">
                  {po.poNo}
                </Link>
                · {supplier} · {format(po.total)} · {po.status}
                {canReceive ? (
                  <Link href={`/store/purchasing/receiving/new?po=${po.id}`} className="underline underline-offset-4">
                    Receive
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>RR no.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rrs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No deliveries received yet.
              </TableCell>
            </TableRow>
          ) : null}
          {rrs.map(({ rr, supplier }) => (
            <TableRow key={rr.id}>
              <TableCell>
                <Link href={`/store/purchasing/receiving/${rr.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {rr.rrNo}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(rr.rrDate)}</TableCell>
              <TableCell>{supplier}</TableCell>
              <TableCell>{rr.invoiceNo ?? "—"}</TableCell>
              <TableCell>{rr.payment === "CASH" ? "Cash" : "On account"}</TableCell>
              <TableCell className="text-right tabular-nums">{format(rr.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ReceivingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReceivingContent />
    </Suspense>
  );
}
