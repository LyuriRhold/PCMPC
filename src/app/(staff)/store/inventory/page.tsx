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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { selectClass } from "@/modules/members/ui/member-form";
import { listCategories, listProducts } from "@/modules/store/service";
import { formatCost4, StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Products & inventory · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function ProductsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = z.object({ q: one, category: one.pipe(z.uuid().optional().catch(undefined)) }).parse(await searchParams);
  const [rows, categories] = await Promise.all([listProducts({ q: f.q, categoryId: f.category }), listCategories()]);
  const total = rows.reduce((s, r) => s + r.value, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Products &amp; inventory</h1>
          <p className="text-sm text-muted-foreground">Stock on hand at moving-average cost. Stock comes in through receiving reports and changes after an approved stock count.</p>
        </div>
        {can(access.user, "store.price") ? (
          <Button nativeButton={false} render={<Link href="/store/inventory/new" />}>
            New product
          </Button>
        ) : null}
      </div>
      <StoreTabs section="inventory" current="/store/inventory" />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search SKU, barcode or name</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category">Category</Label>
          <select id="category" name="category" className={selectClass} defaultValue={f.category ?? ""}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
        <Link href="/store/inventory" className="text-sm underline underline-offset-4">
          Clear
        </Link>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Average cost</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No products match.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ product: p, category, qty, avgCost, value }) => (
            <TableRow key={p.id}>
              <TableCell className="font-mono text-xs">{p.sku}</TableCell>
              <TableCell>
                <Link href={`/store/inventory/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                  {p.name}
                </Link>
                {p.isActive ? null : (
                  <Badge variant="outline" className="ml-2">
                    Inactive
                  </Badge>
                )}
                {p.isActive && qty <= p.reorderLevel ? (
                  <Badge variant="secondary" className="ml-2">
                    Reorder
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{category ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{format(p.sellingPrice)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {qty} {p.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCost4(avgCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={6}>Total inventory value</TableCell>
            <TableCell className="text-right tabular-nums">{format(total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function ProductsPage(props: PageProps<"/store/inventory">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProductsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
