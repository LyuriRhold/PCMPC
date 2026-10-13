import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { inventoryValuation } from "@/modules/store/reports";
import { formatCost4, StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Inventory valuation · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function ValuationContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z.object({ asOf: one }).parse(await searchParams);
  const today = businessToday();
  const asOf = sp.asOf && isBusinessDate(sp.asOf) && sp.asOf <= today ? sp.asOf : today;
  const v = await inventoryValuation(asOf);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Inventory valuation</h1>
        <p className="text-sm text-muted-foreground">Stock on hand at moving-average cost as of a date, checked against the Merchandise Inventory account in the general ledger.</p>
      </div>
      <StoreTabs section="inventory" current="/store/inventory/valuation" />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asOf">As of</Label>
          <Input id="asOf" name="asOf" type="date" defaultValue={asOf} max={today} />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Inventory at cost, {formatDate(asOf)}</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="valuation-total">
            {format(v.total)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">GL Merchandise Inventory</p>
          <p className="text-lg font-semibold tabular-nums">{format(v.glBalance)}</p>
        </div>
        <div className={`rounded-lg border p-3 ${v.difference === 0n ? "" : "border-destructive"}`}>
          <p className="text-xs text-muted-foreground">Difference</p>
          <p className={`text-lg font-semibold tabular-nums ${v.difference === 0n ? "" : "text-destructive"}`}>{v.difference === 0n ? "None: they agree" : format(v.difference)}</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Average cost</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {v.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No stock on that date.
              </TableCell>
            </TableRow>
          ) : null}
          {v.rows.map((r) => (
            <TableRow key={r.product.id}>
              <TableCell>
                <Link href={`/store/inventory/${r.product.id}`} className="underline-offset-4 hover:underline">
                  <span className="font-mono text-xs">{r.product.sku}</span> {r.product.name}
                </Link>
              </TableCell>
              <TableCell>{r.category ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.qty} {r.product.unit}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCost4(r.avgCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(r.value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(v.total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function ValuationPage(props: PageProps<"/store/inventory/valuation">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ValuationContent searchParams={props.searchParams} />
    </Suspense>
  );
}
