import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { shiftReading, shiftSales } from "@/modules/store/pos";
import { CloseShiftForm, VerifyShiftButton } from "@/modules/store/ui/pos-forms";

export const metadata: Metadata = { title: "POS shift · PCMPC MIS" };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 text-sm ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

async function ShiftContent(props: PageProps<"/store/pos/shifts/[id]">) {
  const access = await guardPageAny(["store.pos", "store.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const z0 = await shiftReading(id).catch(() => null);
  if (!z0) notFound();
  const { shift: s } = z0;
  const user = access.user;
  if (s.cashierId !== user.id && !can(user, "store.read")) return <Forbidden permission="store.read" />;
  const sales = await shiftSales(s.id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/store/pos" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Point of sale
        </Link>
        <PrintButton />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {s.status === "OPEN" ? "X-reading" : "Z-reading"}, shift of {formatDate(s.businessDate)}
        </h1>
        <Badge variant="outline" data-testid="shift-status">
          {s.status}
        </Badge>
      </div>

      <dl className="max-w-md divide-y rounded-lg border px-4 py-2">
        <Row label={`Sales (${z0.salesCount})`} value={format(z0.grossSales)} />
        <Row label="  of which cash" value={format(z0.cashSales)} />
        <Row label="  of which charged to members" value={format(z0.chargeSales)} />
        <Row label={`Returns (${z0.returnsCount})`} value={format(-z0.returns)} />
        <Row label="Net sales" value={format(z0.netSales)} strong />
        <Row label="Net cash sales" value={format(z0.netCashSales)} />
        <Row label="Voided sales" value={String(z0.voidsCount)} />
        <Row label="Opening fund" value={format(z0.openingFund)} />
        <Row label="Cash expected in the drawer" value={format(z0.expectedCash)} strong />
        {s.countedCash !== null ? <Row label="Cash counted" value={format(s.countedCash)} /> : null}
        {s.variance !== null ? <Row label={s.variance < 0n ? "Short" : s.variance > 0n ? "Over" : "Variance"} value={format(s.variance)} strong /> : null}
      </dl>

      {s.status === "OPEN" && s.cashierId === user.id ? <CloseShiftForm shiftId={s.id} /> : null}
      {s.status === "CLOSED" && can(user, "cash.verify") && s.cashierId !== user.id ? <VerifyShiftButton shiftId={s.id} /> : null}
      {s.varianceJeId ? (
        <p className="text-sm">
          <Link href={`/accounting/journals/${s.varianceJeId}`} className="underline underline-offset-4">
            Cash short/over entry
          </Link>
        </p>
      ) : null}

      <section className="flex flex-col gap-2 print:hidden">
        <h2 className="text-sm font-semibold">Sales on this shift</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sale no.</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No sales yet.
                </TableCell>
              </TableRow>
            ) : null}
            {sales.map(({ sale, memberNo, lastName, firstName }) => (
              <TableRow key={sale.id}>
                <TableCell>
                  <Link href={`/store/pos/sales/${sale.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                    {sale.saleNo}
                  </Link>
                </TableCell>
                <TableCell>{memberNo ? `${lastName}, ${firstName} (${memberNo})` : "Walk-in"}</TableCell>
                <TableCell>{sale.payment === "CHARGE" ? "Charge" : "Cash"}</TableCell>
                <TableCell className="text-right tabular-nums">{format(sale.total)}</TableCell>
                <TableCell>{sale.status === "VOIDED" ? <Badge variant="destructive">VOIDED</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

export default function ShiftPage(props: PageProps<"/store/pos/shifts/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ShiftContent {...props} />
    </Suspense>
  );
}
