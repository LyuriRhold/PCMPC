import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getRr } from "@/modules/store/purchasing";

export const metadata: Metadata = { title: "Receiving report · PCMPC MIS" };

async function RrContent(props: PageProps<"/store/purchasing/receiving/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getRr(id);
  if (!data) notFound();
  const { rr, supplier, lines, po, dv } = data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/store/purchasing/receiving" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Receiving
        </Link>
        <h1 className="text-2xl font-semibold">Receiving report {rr.rrNo}</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/store/purchasing/suppliers/${supplier.id}`} className="underline underline-offset-4">
            {supplier.name}
          </Link>{" "}
          · received {formatDate(rr.rrDate)}
          {rr.invoiceNo ? ` · invoice ${rr.invoiceNo}` : ""}
          {po ? (
            <>
              {" · "}
              <Link href={`/store/purchasing/orders/${po.id}`} className="underline underline-offset-4">
                {po.poNo}
              </Link>
            </>
          ) : (
            " · no PO"
          )}
          {" · "}
          <Link href={`/accounting/journals/${rr.jeId}`} className="underline underline-offset-4">
            journal entry
          </Link>
        </p>
        <p className="text-sm">
          {rr.payment === "CASH" ? (
            <>
              Cash on delivery: paid by{" "}
              {dv ? (
                <Link href={`/cashiering/vouchers/${dv.id}`} className="underline underline-offset-4">
                  {dv.dvNo} ({dv.status})
                </Link>
              ) : null}
            </>
          ) : (
            `On account: due ${formatDate(rr.dueDate)}`
          )}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No.</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map(({ line, product }) => (
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
              <TableCell className="text-right tabular-nums">{format(line.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(line.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(rr.total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function RrPage(props: PageProps<"/store/purchasing/receiving/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <RrContent {...props} />
    </Suspense>
  );
}
