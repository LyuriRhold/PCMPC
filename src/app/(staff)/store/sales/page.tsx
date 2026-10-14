import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { salesReport, slowMovers, type Figures } from "@/modules/store/sales-reports";

export const metadata: Metadata = { title: "Store sales & margin · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

function FigureCells({ f }: { f: Figures }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{f.qty}</TableCell>
      <TableCell className="text-right tabular-nums">{format(f.sales)}</TableCell>
      <TableCell className="text-right tabular-nums">{f.returns ? format(-f.returns) : ""}</TableCell>
      <TableCell className="text-right tabular-nums">{format(f.net)}</TableCell>
      <TableCell className="text-right tabular-nums">{format(f.cogs)}</TableCell>
      <TableCell className="text-right tabular-nums">{format(f.margin)}</TableCell>
      <TableCell className="text-right tabular-nums">{f.marginPct}%</TableCell>
    </>
  );
}

function FigureHeads({ first }: { first: string }) {
  return (
    <TableRow>
      <TableHead>{first}</TableHead>
      <TableHead className="text-right">Units</TableHead>
      <TableHead className="text-right">Sales</TableHead>
      <TableHead className="text-right">Returns</TableHead>
      <TableHead className="text-right">Net sales</TableHead>
      <TableHead className="text-right">Cost of sales</TableHead>
      <TableHead className="text-right">Gross margin</TableHead>
      <TableHead className="text-right">Margin</TableHead>
    </TableRow>
  );
}

async function SalesContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z.object({ from: one, to: one }).parse(await searchParams);
  const today = businessToday();
  const from = sp.from && isBusinessDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = sp.to && isBusinessDate(sp.to) ? sp.to : today;
  const [r, slow] = await Promise.all([salesReport(from, to), slowMovers(from, to)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Store sales &amp; margin</h1>
        <p className="text-sm text-muted-foreground">
          Sales count on their sale date and returns on their return date. Gross margin is net sales less the cost of what was sold (at moving-average cost) net of returns.
        </p>
      </div>
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

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Net sales ({r.salesCount} sales)</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="net-sales">
            {format(r.total.net)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Returns</p>
          <p className="text-lg font-semibold tabular-nums">{format(r.total.returns)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Cost of sales</p>
          <p className="text-lg font-semibold tabular-nums">{format(r.total.cogs)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Gross margin</p>
          <p className="text-lg font-semibold tabular-nums">
            {format(r.total.margin)} · {r.total.marginPct}%
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By day</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <FigureHeads first="Date" />
            </TableHeader>
            <TableBody>
              {r.byDay.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No sales from {formatDate(from)} to {formatDate(to)}.
                  </TableCell>
                </TableRow>
              ) : null}
              {r.byDay.map((d) => (
                <TableRow key={d.day}>
                  <TableCell className="tabular-nums">{formatDate(d.day)}</TableCell>
                  <FigureCells f={d} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <FigureHeads first="Category" />
            </TableHeader>
            <TableBody>
              {r.byCategory.map((c) => (
                <TableRow key={c.category}>
                  <TableCell>{c.category}</TableCell>
                  <FigureCells f={c} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By product (top sellers first)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <FigureHeads first="Product" />
            </TableHeader>
            <TableBody>
              {r.byProduct.map((p) => (
                <TableRow key={p.product.id}>
                  <TableCell>
                    <Link href={`/store/inventory/${p.product.id}`} className="underline-offset-4 hover:underline">
                      <span className="font-mono text-xs">{p.product.sku}</span> {p.product.name}
                    </Link>
                  </TableCell>
                  <FigureCells f={p} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slow movers (in stock, fewest sold)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Sold in the range</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Stock value</TableHead>
                <TableHead>Last sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slow.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Nothing in stock.
                  </TableCell>
                </TableRow>
              ) : null}
              {slow.map((s) => (
                <TableRow key={s.product.id}>
                  <TableCell>
                    <Link href={`/store/inventory/${s.product.id}`} className="underline-offset-4 hover:underline">
                      <span className="font-mono text-xs">{s.product.sku}</span> {s.product.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.soldQty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.onHand} {s.product.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(s.value)}</TableCell>
                  <TableCell className="tabular-nums">{s.lastSold ? formatDate(s.lastSold) : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalesPage(props: PageProps<"/store/sales">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SalesContent searchParams={props.searchParams} />
    </Suspense>
  );
}
