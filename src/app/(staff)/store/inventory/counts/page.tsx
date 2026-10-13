import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { listCategories, listCounts } from "@/modules/store/service";
import { NewCountForm } from "@/modules/store/ui/count-forms";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Stock counts · PCMPC MIS" };

async function CountsContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [counts, categories] = await Promise.all([listCounts(), listCategories()]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Stock counts</h1>
        <p className="text-sm text-muted-foreground">
          The store clerk counts the shelves and submits the sheet; the manager approves it, which posts the shortages (Inventory Losses) and overages to stock and the books. Nothing is posted before approval.
        </p>
      </div>
      <StoreTabs section="inventory" current="/store/inventory/counts" />
      {can(access.user, "store.adjust") ? <NewCountForm categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Count no.</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Remarks</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {counts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No counts yet.
              </TableCell>
            </TableRow>
          ) : null}
          {counts.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link href={`/store/inventory/counts/${c.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {c.countNo}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(c.countDate)}</TableCell>
              <TableCell>{c.remarks ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline">{c.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CountsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CountsContent />
    </Suspense>
  );
}
