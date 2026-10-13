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
import { formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getProduct, listCategories } from "@/modules/store/service";
import { PriceForm, ProductForm, VAT_LABEL } from "@/modules/store/ui/store-forms";
import { formatCost4 } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Product · PCMPC MIS" };

async function ProductContent(props: PageProps<"/store/inventory/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getProduct(id);
  if (!data) notFound();
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
