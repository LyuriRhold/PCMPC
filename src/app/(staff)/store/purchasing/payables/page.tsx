import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { listSuppliers } from "@/modules/store/service";
import { PaySupplierForm } from "@/modules/store/ui/purchasing-forms";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Supplier payables · PCMPC MIS" };

async function PayablesContent() {
  const access = await guardPageAny(["store.read", "cash.dv_prepare"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const rows = (await listSuppliers()).filter((r) => r.balance !== 0n);
  const total = rows.reduce((s, r) => s + r.balance, 0n);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Supplier payables</h1>
        <p className="text-sm text-muted-foreground">
          What the store owes each supplier (Accounts Payable – Trade). The bookkeeper prepares a payment voucher; the manager approves it; a teller releases it by check or from the drawer.
        </p>
      </div>
      <StoreTabs section="purchasing" current="/store/purchasing/payables" />
      {can(access.user, "cash.dv_prepare") && rows.length ? (
        <PaySupplierForm suppliers={rows.filter((r) => r.balance > 0n).map((r) => ({ id: r.supplier.id, label: `${r.supplier.name} · owed ${format(r.balance)}` }))} />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Terms</TableHead>
            <TableHead className="text-right">Owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                The store owes no supplier.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ supplier: s, balance }) => (
            <TableRow key={s.id}>
              <TableCell>
                <Link href={`/store/purchasing/suppliers/${s.id}`} className="underline-offset-4 hover:underline">
                  {s.name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{s.termsDays} days</TableCell>
              <TableCell className="text-right tabular-nums">{format(balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function PayablesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PayablesContent />
    </Suspense>
  );
}
