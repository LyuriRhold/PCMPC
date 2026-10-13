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
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { apAging } from "@/modules/store/reports";
import { PaySupplierForm } from "@/modules/store/ui/purchasing-forms";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Supplier payables · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function PayablesContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPageAny(["store.read", "cash.dv_prepare"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const sp = z.object({ asOf: one }).parse(await searchParams);
  const today = businessToday();
  const asOf = sp.asOf && isBusinessDate(sp.asOf) && sp.asOf <= today ? sp.asOf : today;
  const aging = await apAging(asOf);
  const sum = (label: string) => aging.rows.reduce((s, r) => s + (r.buckets[label] ?? 0n), 0n);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Supplier payables</h1>
        <p className="text-sm text-muted-foreground">
          What the store owes each supplier (Accounts Payable – Trade), by days past due: each delivery is due on its receiving date plus the supplier&apos;s terms, and payments settle the oldest first. The
          bookkeeper prepares a payment voucher; the manager approves it; a teller releases it by check or from the drawer.
        </p>
      </div>
      <StoreTabs section="purchasing" current="/store/purchasing/payables" />
      {can(access.user, "cash.dv_prepare") && asOf === today && aging.rows.some((r) => r.balance > 0n) ? (
        <PaySupplierForm suppliers={aging.rows.filter((r) => r.balance > 0n).map((r) => ({ id: r.supplierId, label: `${r.name} · owed ${format(r.balance)}` }))} />
      ) : null}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asOf">As of</Label>
          <Input id="asOf" name="asOf" type="date" defaultValue={asOf} max={today} />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Oldest due</TableHead>
            {aging.buckets.map((b) => (
              <TableHead key={b} className="text-right">
                {b}
              </TableHead>
            ))}
            <TableHead className="text-right">Owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aging.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={aging.buckets.length + 3} className="text-center text-sm text-muted-foreground">
                The store owed no supplier on {formatDate(asOf)}.
              </TableCell>
            </TableRow>
          ) : null}
          {aging.rows.map((r) => (
            <TableRow key={r.supplierId}>
              <TableCell>
                <Link href={`/store/purchasing/suppliers/${r.supplierId}`} className="underline-offset-4 hover:underline">
                  {r.name}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{r.oldestDue ? formatDate(r.oldestDue) : "—"}</TableCell>
              {aging.buckets.map((b) => (
                <TableCell key={b} className="text-right tabular-nums">
                  {r.buckets[b] ? format(r.buckets[b]) : ""}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">{format(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total</TableCell>
            {aging.buckets.map((b) => (
              <TableCell key={b} className="text-right tabular-nums">
                {format(sum(b))}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums">{format(aging.total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function PayablesPage(props: PageProps<"/store/purchasing/payables">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PayablesContent searchParams={props.searchParams} />
    </Suspense>
  );
}
