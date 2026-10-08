import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { getReceipt } from "@/modules/cashiering/queries";
import { CancelReceiptForm, PrintButton } from "@/modules/cashiering/ui/buttons";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Receipt · PCMPC MIS" };

async function ReceiptContent(props: PageProps<"/cashiering/receipts/[id]">) {
  const access = await guardPageAny(["cash.session", "cash.cancel", "gl.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const r = await getReceipt(id);
  if (!r) notFound();
  const [coop, address, tin] = await Promise.all([getSetting("coop.name"), getSetting("coop.address"), getSetting("coop.tin")]);
  const canCancel =
    r.status === "VALID" && can(access.user, "cash.cancel") && access.user.id !== r.tellerId && r.receiptDate === businessToday() && r.sessionStatus === "OPEN";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/cashiering/teller">
          ← Teller counter
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto w-full max-w-md rounded-lg border p-6 print:border-0 print:p-0">
        <header className="mb-4 text-center">
          <p className="font-semibold">{coop}</p>
          <p className="text-xs text-muted-foreground">{address}</p>
          {tin ? <p className="text-xs text-muted-foreground">TIN {tin}</p> : null}
          <h1 className="mt-3 text-lg font-semibold">Acknowledgement receipt {r.receiptNo}</h1>
          <p className="text-xs text-muted-foreground">Not an official receipt. BIR receipt / invoice no. {r.birReceiptNo ?? "—"}</p>
          {r.status === "CANCELLED" ? <p className="mt-2 font-semibold text-destructive">CANCELLED: {r.cancelReason}</p> : null}
        </header>
        <dl className="mb-3 grid grid-cols-[7rem_1fr] gap-1 text-sm">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDate(r.receiptDate)}</dd>
          <dt className="text-muted-foreground">Received from</dt>
          <dd>{r.payorName}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd>
            {r.mode}
            {r.checkNo ? ` · check ${r.checkNo}` : ""}
          </dd>
        </dl>
        <table className="w-full text-sm">
          <tbody>
            {r.items.map((i) => (
              <tr key={i.id} className="border-b">
                <td className="py-1.5">{i.description}</td>
                <td className="py-1.5 text-right tabular-nums">{format(i.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right tabular-nums">{format(r.total)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-xs text-muted-foreground">
          Received by {r.tellerName} · {formatDateTime(r.createdAt)} · {r.jeNo}
        </p>
      </article>

      {canCancel ? <CancelReceiptForm receiptId={r.id} /> : null}
    </div>
  );
}

export default function ReceiptPage(props: PageProps<"/cashiering/receipts/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReceiptContent {...props} />
    </Suspense>
  );
}
