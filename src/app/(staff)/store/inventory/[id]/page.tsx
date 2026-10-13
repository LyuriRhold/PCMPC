import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { businessToday, formatDate, formatDateTime, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { stockCard } from "@/modules/store/reports";
import { getProduct, listCategories } from "@/modules/store/service";
import { PriceForm, ProductForm, VAT_LABEL } from "@/modules/store/ui/store-forms";
import { formatCost4 } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Product · PCMPC MIS" };

const MOVE_LABEL: Record<string, string> = { RECEIVE: "Received", SALE: "Sold", RETURN: "Returned", ADJUST: "Count adjustment" };

async function ProductContent(props: PageProps<"/store/inventory/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getProduct(id);
  if (!data) notFound();
  const sp = await props.searchParams;
  const today = businessToday();
  const pick = (v: unknown, d: string) => (typeof v === "string" && isBusinessDate(v) ? v : d);
  const from = pick(sp.from, `${today.slice(0, 4)}-01-01`);
  const to = pick(sp.to, today);
  const card = await stockCard(id, from, to);
  const { product: p, balance, prices } = data;
  const canPrice = can(access.user, "store.price");
  const categories = canPrice ? await listCategories() : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/store/inventory" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Products &amp; inventory
        </Link>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{p.sku}</span>
          {p.barcode ? ` · barcode ${p.barcode}` : ""} · {data.category ?? "no category"} · per {p.unit} · {VAT_LABEL[p.vatClass]}
          {p.isActive ? "" : " · inactive"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">On hand ({p.unit})</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="stock-qty">
            {balance.qty}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Average cost</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="stock-avg">
            {formatCost4(balance.avgCost)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Value</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="stock-value">
            {format(balance.value)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Selling price · reorder at</p>
          <p className="text-lg font-semibold tabular-nums">
            {format(p.sellingPrice)} · {p.reorderLevel}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock card</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <Button type="submit" size="sm">
              Show
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={6}>Balance before {formatDate(from)}</TableCell>
                <TableCell className="text-right tabular-nums">{card.opening.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCost4(card.opening.avgCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(card.opening.value)}</TableCell>
              </TableRow>
              {card.moves.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums">{formatDate(m.moveDate)}</TableCell>
                  <TableCell>
                    {MOVE_LABEL[m.type] ?? m.type}
                    {m.document ? (
                      <Link href={m.refType === "RR" ? `/store/purchasing/receiving/${m.refId}` : `/store/inventory/counts/${m.refId}`} className="ml-1 font-mono text-xs underline underline-offset-4">
                        {m.document}
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.qty > 0 ? m.qty : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.qty < 0 ? -m.qty : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost4(m.unitCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(m.totalCost < 0n ? -m.totalCost : m.totalCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.qtyAfter}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost4(m.avgCostAfter)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(m.valueAfter)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Price history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {canPrice ? <PriceForm productId={p.id} /> : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="tabular-nums">{formatDateTime(h.effectiveAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(h.price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {canPrice ? (
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductForm
                categories={categories.filter((c) => c.isActive || c.id === p.categoryId).map((c) => ({ id: c.id, name: c.name }))}
                product={{ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, categoryId: p.categoryId, reorderLevel: p.reorderLevel, vatClass: p.vatClass, isActive: p.isActive }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default function ProductPage(props: PageProps<"/store/inventory/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProductContent {...props} />
    </Suspense>
  );
}
