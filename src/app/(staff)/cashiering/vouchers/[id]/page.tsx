import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { getDv } from "@/modules/cashiering/queries";
import { DvButtons, PrintButton } from "@/modules/cashiering/ui/buttons";

export const metadata: Metadata = { title: "Disbursement voucher · PCMPC MIS" };

async function DvContent(props: PageProps<"/cashiering/vouchers/[id]">) {
  const access = await guardPageAny(["cash.dv_prepare", "cash.dv_approve", "cash.session"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const dv = await getDv(id);
  if (!dv) notFound();
  const isPreparer = dv.preparedBy === access.user.id;
  const canApprove = dv.status === "DRAFT" && can(access.user, "cash.dv_approve") && !isPreparer;
  const canRelease = dv.status === "APPROVED" && can(access.user, "cash.session");
  const canCancel = (dv.status === "DRAFT" || dv.status === "APPROVED") && can(access.user, "cash.dv_approve");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/cashiering/vouchers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Disbursement vouchers
        </Link>
        <PrintButton />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Disbursement voucher {dv.dvNo}</h1>
        <p className="text-sm text-muted-foreground">
          {dv.status} · {formatDate(dv.dvDate)} · {dv.mode}
          {dv.checkNo ? ` · check ${dv.checkNo}` : ""}
          {dv.jeNo ? ` · ${dv.jeNo}` : ""}
        </p>
        <p className="text-sm">
          Pay to <span className="font-medium">{dv.payee}</span>: {dv.particulars}
        </p>
        <p className="text-xs text-muted-foreground">
          Prepared by {dv.preparedByName}
          {dv.approvedByName ? ` · approved by ${dv.approvedByName}` : ""}
          {dv.releasedByName ? ` · released by ${dv.releasedByName}${dv.releasedAt ? ` ${formatDateTime(dv.releasedAt)}` : ""}` : ""}
          {dv.cancelReason ? ` · cancelled: ${dv.cancelReason}` : ""}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account debited</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dv.lines.map((l) => (
            <TableRow key={l.lineNo}>
              <TableCell>
                <span className="font-mono text-xs">{l.code}</span> {l.name}
              </TableCell>
              <TableCell className="text-xs">{l.memberNo ?? ""}</TableCell>
              <TableCell className="text-xs">{l.memo ?? ""}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total (credit {dv.mode === "CASH" ? "Cash on Hand" : "Cash in Bank"})</TableCell>
            <TableCell className="text-right tabular-nums">{format(dv.amount)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {dv.status === "DRAFT" && isPreparer && can(access.user, "cash.dv_approve") ? (
        <p className="text-sm text-muted-foreground">You prepared this DV. Another user must approve it.</p>
      ) : null}
      <div className="print:hidden">
        <DvButtons dvId={dv.id} canApprove={canApprove} canRelease={canRelease} canCancel={canCancel} />
      </div>
    </div>
  );
}

export default function DvPage(props: PageProps<"/cashiering/vouchers/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <DvContent {...props} />
    </Suspense>
  );
}
