import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { listSuppliers } from "@/modules/store/service";
import { SupplierForm } from "@/modules/store/ui/store-forms";
import { StoreTabs } from "@/modules/store/ui/store-nav";

export const metadata: Metadata = { title: "Suppliers · PCMPC MIS" };

async function SuppliersContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const rows = await listSuppliers();
  const owed = rows.reduce((s, r) => s + r.balance, 0n);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        <p className="text-sm text-muted-foreground">Who the store buys from, their credit terms and what the store owes each (Accounts Payable – Trade).</p>
      </div>
      <StoreTabs section="purchasing" current="/store/purchasing/suppliers" />
      {can(access.user, "store.receive") ? <SupplierForm /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>TIN</TableHead>
            <TableHead className="text-right">Terms</TableHead>
            <TableHead className="text-right">Owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No suppliers yet.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map(({ supplier: s, balance }) => (
            <TableRow key={s.id}>
              <TableCell>
                <Link href={`/store/purchasing/suppliers/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                  {s.name}
                </Link>
                {s.isActive ? "" : " (inactive)"}
              </TableCell>
              <TableCell>{s.contact ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{s.tin ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{s.termsDays} days</TableCell>
              <TableCell className="text-right tabular-nums">{format(balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total owed</TableCell>
            <TableCell className="text-right tabular-nums">{format(owed)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SuppliersContent />
    </Suspense>
  );
}
