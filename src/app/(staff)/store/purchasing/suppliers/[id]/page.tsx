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
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { supplierLedger } from "@/modules/ledger/service";
import { getSupplier } from "@/modules/store/service";
import { SupplierForm } from "@/modules/store/ui/store-forms";

export const metadata: Metadata = { title: "Supplier · PCMPC MIS" };

async function SupplierContent(props: PageProps<"/store/purchasing/suppliers/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await getSupplier(id);
  if (!s) notFound();
  const today = businessToday();
  const ledger = await supplierLedger("accounts_payable_trade", s.id, `${today.slice(0, 4)}-01-01`, today);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/store/purchasing/suppliers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Suppliers
        </Link>
        <h1 className="text-2xl font-semibold">{s.name}</h1>
        <p className="text-sm text-muted-foreground">
          {s.contact ?? "No contact"} · {s.tin ? `TIN ${s.tin}` : "no TIN"} · {s.termsDays} days{s.isActive ? "" : " · inactive"}
        </p>
      </div>
      <div className="rounded-lg border p-3 sm:w-72">
        <p className="text-xs text-muted-foreground">The store owes (AP – Trade)</p>
        <p className="text-lg font-semibold tabular-nums" data-testid="supplier-balance">
          {format(ledger.closing)}
        </p>
      </div>
      {can(access.user, "store.receive") ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierForm supplier={{ id: s.id, name: s.name, contact: s.contact, tin: s.tin, termsDays: s.termsDays, isActive: s.isActive }} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Payables ledger, {today.slice(0, 4)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Paid (Dr)</TableHead>
                <TableHead className="text-right">Owed (Cr)</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5}>Opening balance</TableCell>
                <TableCell className="text-right tabular-nums">{format(ledger.opening)}</TableCell>
              </TableRow>
              {ledger.lines.map((l, i) => (
                <TableRow key={`${l.jeId}-${i}`}>
                  <TableCell className="tabular-nums">{formatDate(l.date)}</TableCell>
                  <TableCell>
                    <Link href={`/accounting/journals/${l.jeId}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {l.jeNo}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-96 truncate">{l.particulars}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.debit ? format(l.debit) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.credit ? format(l.credit) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(l.running)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SupplierPage(props: PageProps<"/store/purchasing/suppliers/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SupplierContent {...props} />
    </Suspense>
  );
}
