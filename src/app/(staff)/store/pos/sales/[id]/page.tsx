import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { getSetting } from "@/modules/settings/service";
import { getSale } from "@/modules/store/pos";
import { ReturnForm } from "@/modules/store/ui/pos-forms";

export const metadata: Metadata = { title: "Sale · PCMPC MIS" };

async function SaleContent(props: PageProps<"/store/pos/sales/[id]">) {
  const access = await guardPageAny(["store.pos", "store.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getSale(id);
  if (!data) notFound();
  const { sale, member, lines, returns } = data;
  const [coop, address, tin] = await Promise.all([getSetting("coop.name"), getSetting("coop.address"), getSetting("coop.tin")]);
  const returnable = lines.filter((l) => l.qty > l.returnedQty);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-muted-foreground underline underline-offset-4" href={`/store/pos/shifts/${sale.shiftId}`}>
          ← Shift
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto w-full max-w-sm rounded-lg border p-5 font-mono text-sm print:border-0 print:p-0">
        <header className="mb-3 text-center">
          <p className="font-semibold">{coop}</p>
          <p className="text-xs">{address}</p>
          {tin ? <p className="text-xs">TIN {tin}</p> : null}
          <h1 className="mt-2 font-semibold">Sale {sale.saleNo}</h1>
          <p className="text-xs">{sale.birInvoiceNo ? `BIR invoice no. ${sale.birInvoiceNo}` : "Not an official receipt"}</p>
          {sale.status === "VOIDED" ? <p className="mt-1 font-semibold text-destructive">VOIDED: {sale.voidReason}</p> : null}
        </header>
        <p className="text-xs">
          {formatDate(sale.saleDate)} · {formatDateTime(sale.createdAt)}
        </p>
        <p className="mb-2 text-xs">{member ? `Member ${member.memberNo} ${member.lastName}, ${member.firstName}` : "Walk-in customer"}</p>
        <table className="w-full">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="py-0.5">
                  {l.name}
                  <div className="text-xs">
                    {l.qty} × {format(l.unitPrice)}
                  </div>
                </td>
                <td className="py-0.5 text-right">{format(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t">
            <tr className="font-semibold">
              <td className="pt-1">Total</td>
              <td className="pt-1 text-right">{format(sale.total)}</td>
            </tr>
            {sale.payment === "CASH" && sale.tendered !== null ? (
              <>
                <tr>
                  <td>Cash</td>
                  <td className="text-right">{format(sale.tendered)}</td>
                </tr>
                <tr>
                  <td>Change</td>
                  <td className="text-right">{format(sale.change ?? 0n)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={2}>Charged to the member&apos;s store account</td>
              </tr>
            )}
          </tfoot>
        </table>
        {returns.length ? (
          <div className="mt-3 border-t pt-2 text-xs">
            {returns.map((r) => (
              <p key={r.id}>
                Return {r.returnNo} · {formatDate(r.returnDate)} · {format(r.total)} {r.refundMode === "AR" ? "credited to the account" : "refunded in cash"}
              </p>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-center text-xs">Thank you!</p>
      </article>

      {sale.status === "COMPLETED" && can(access.user, "store.pos") && returnable.length ? (
        <div className="mx-auto w-full max-w-xl print:hidden">
          <ReturnForm saleId={sale.id} charge={sale.payment === "CHARGE"} lines={returnable.map((l) => ({ id: l.id, label: `${l.sku} ${l.name}`, left: l.qty - l.returnedQty }))} />
        </div>
      ) : null}
    </div>
  );
}

export default function SalePage(props: PageProps<"/store/pos/sales/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SaleContent {...props} />
    </Suspense>
  );
}
