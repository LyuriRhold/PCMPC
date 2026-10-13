import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPage } from "@/lib/page-guard";
import { reorderList } from "@/modules/store/reports";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Reorder list · PCMPC MIS" };

async function ReorderContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const rows = await reorderList();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Reorder list</h1>
        <p className="text-sm text-muted-foreground">Active products at or below their reorder level, with what is already on order (approved purchase orders still to come).</p>
      </div>
      <StoreTabs section="inventory" current="/store/inventory/reorder" />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Reorder level</TableHead>
            <TableHead className="text-right">On order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                Nothing to reorder.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((r) => (
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
              <TableCell className="text-right tabular-nums">{r.product.reorderLevel}</TableCell>
              <TableCell className="text-right tabular-nums">{r.onOrder || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ReorderPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReorderContent />
    </Suspense>
  );
}
