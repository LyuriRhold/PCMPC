import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getPo } from "@/modules/store/purchasing";
import { PoActions } from "@/modules/store/ui/purchasing-forms";

export const metadata: Metadata = { title: "Purchase order · PCMPC MIS" };

async function PoContent(props: PageProps<"/store/purchasing/orders/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getPo(id);
  if (!data) notFound();
  const { po, supplier, lines, rrs } = data;
  const user = access.user;
  const open = po.status === "APPROVED" || po.status === "PARTIAL";
  const canApprove = po.status === "DRAFT" && can(user, "store.po_approve") && po.preparedBy !== user.id;
  const canCancel = po.status !== "RECEIVED" && po.status !== "CANCELLED" && can(user, "store.po_approve");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/store/purchasing" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Purchasing
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Purchase order {po.poNo}</h1>
          <span className="rounded-full border px-3 py-0.5 text-sm font-medium" data-testid="po-status">
            {po.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/store/purchasing/suppliers/${supplier.id}`} className="underline underline-offset-4">
            {supplier.name}
          </Link>{" "}
          · {formatDate(po.poDate)} · {supplier.termsDays} days{po.remarks ? ` · ${po.remarks}` : ""}
          {po.cancelReason ? ` · cancelled: ${po.cancelReason}` : ""}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No.</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">To come</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map(({ line, product, remaining }) => (
            <TableRow key={line.id}>
              <TableCell>{line.lineNo}</TableCell>
              <TableCell>
                <Link href={`/store/inventory/${product.id}`} className="underline-offset-4 hover:underline">
                  {product.sku} · {product.name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {line.qty} {product.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums">{line.qtyReceived}</TableCell>
              <TableCell className="text-right tabular-nums">{po.status === "CANCELLED" ? "—" : remaining}</TableCell>
              <TableCell className="text-right tabular-nums">{format(line.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(line.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={6}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(po.total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      {open && can(user, "store.receive") ? (
        <div>
          <Button nativeButton={false} render={<Link href={`/store/purchasing/receiving/new?po=${po.id}`} />}>
            Receive delivery
          </Button>
        </div>
      ) : null}
      {po.status === "DRAFT" && po.preparedBy === user.id ? <p className="text-sm text-muted-foreground">You prepared this order. The manager approves it.</p> : null}
      {canApprove || canCancel ? <PoActions poId={po.id} canApprove={canApprove} canCancel={canCancel} /> : null}

      {rrs.length ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Deliveries received</h2>
          <ul className="text-sm">
            {rrs.map((r) => (
              <li key={r.id}>
                <Link href={`/store/purchasing/receiving/${r.id}`} className="font-mono text-xs underline underline-offset-4">
                  {r.rrNo}
                </Link>{" "}
                · {formatDate(r.rrDate)} · {format(r.total)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function PoPage(props: PageProps<"/store/purchasing/orders/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PoContent {...props} />
    </Suspense>
  );
}
