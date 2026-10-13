import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getCount } from "@/modules/store/service";
import { ApproveCountButton, CountSheetForm, ReturnCountForm } from "@/modules/store/ui/count-forms";

export const metadata: Metadata = { title: "Stock count · PCMPC MIS" };

async function CountContent(props: PageProps<"/store/inventory/counts/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getCount(id);
  if (!data) notFound();
  const { count: c, lines } = data;
  const user = access.user;
  const shortage = lines.reduce((s, l) => s + (l.varianceValue !== null && l.varianceValue < 0n ? -l.varianceValue : 0n), 0n);
  const overage = lines.reduce((s, l) => s + (l.varianceValue !== null && l.varianceValue > 0n ? l.varianceValue : 0n), 0n);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/store/inventory/counts" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Stock counts
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Stock count {c.countNo}</h1>
          <span className="rounded-full border px-3 py-0.5 text-sm font-medium" data-testid="count-status">
            {c.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDate(c.countDate)}
          {c.remarks ? ` · ${c.remarks}` : ""} · {lines.length} products
          {c.jeId ? (
            <>
              {" · "}
              <Link href={`/accounting/journals/${c.jeId}`} className="underline underline-offset-4">
                adjustment entry
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {c.status === "DRAFT" ? (
        can(user, "store.adjust") ? (
          <CountSheetForm countId={c.id} lines={lines.map((l) => ({ productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, countedQty: l.countedQty }))} />
        ) : (
          <p className="text-sm text-muted-foreground">Being counted by the store clerk.</p>
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">{c.status === "APPROVED" ? "Posted" : "Value now"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id} className={l.variance ? "font-medium" : "text-muted-foreground"}>
                  <TableCell>
                    <Link href={`/store/inventory/${l.productId}`} className="underline-offset-4 hover:underline">
                      <span className="font-mono text-xs">{l.sku}</span> {l.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.systemQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.countedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.variance && l.variance > 0 ? `+${l.variance}` : l.variance}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.varianceValue === null || l.varianceValue === 0n ? "—" : format(l.varianceValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>Shortages · overages</TableCell>
                <TableCell className="text-right tabular-nums">
                  {format(-shortage)} · {format(overage)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {c.status === "SUBMITTED" && can(user, "store.approve_adjust") && c.preparedBy !== user.id && c.submittedBy !== user.id ? (
            <div className="flex flex-col gap-3">
              <ApproveCountButton countId={c.id} />
              <ReturnCountForm countId={c.id} />
            </div>
          ) : null}
          {c.status === "SUBMITTED" && c.preparedBy === user.id ? <p className="text-sm text-muted-foreground">You prepared this count. The manager approves it.</p> : null}
        </>
      )}
    </div>
  );
}

export default function CountPage(props: PageProps<"/store/inventory/counts/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CountContent {...props} />
    </Suspense>
  );
}
