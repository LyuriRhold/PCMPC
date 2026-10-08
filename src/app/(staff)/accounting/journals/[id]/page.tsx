import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getEntry } from "@/modules/ledger/queries";
import { ApproveJvButton, DiscardJvButton, ReverseJvForm } from "@/modules/ledger/ui/jv-actions";
import { JeStatusBadge } from "@/modules/ledger/ui/je-status-badge";

export const metadata: Metadata = { title: "Journal voucher · PCMPC MIS" };

async function EntryContent(props: PageProps<"/accounting/journals/[id]">) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await props.searchParams;
  const postedNo = typeof sp.posted === "string" && /^[A-Z]{2,3}-\d{4}-\d{5}$/.test(sp.posted) ? sp.posted : null;
  const je = await getEntry(id);
  if (!je) notFound();
  const dr = je.lines.reduce((s, l) => s + l.debit, 0n);
  const cr = je.lines.reduce((s, l) => s + l.credit, 0n);
  const isPreparer = je.preparedBy === access.user.id;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/accounting/journals" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Journal vouchers
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Journal voucher {je.jeNo ?? "(draft)"}</h1>
          <JeStatusBadge status={je.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {je.book} · {formatDate(je.entryDate)} · {je.particulars}
          {je.reference ? ` · Ref. ${je.reference}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Prepared by {je.preparedByName ?? "system"}
          {je.approvedByName ? ` · approved by ${je.approvedByName}` : ""}
          {je.postedAt ? ` · posted ${formatDateTime(je.postedAt)}` : ""}
          {je.sourceModule !== "manual_jv" ? ` · source: ${je.sourceModule}` : ""}
        </p>
        {je.reversalOf ? (
          <p className="text-sm">
            Reverses{" "}
            <Link className="underline" href={`/accounting/journals/${je.reversalOf.id}`}>
              {je.reversalOf.jeNo}
            </Link>
          </p>
        ) : null}
        {je.reversedBy ? (
          <p className="text-sm">
            Reversed by{" "}
            <Link className="underline" href={`/accounting/journals/${je.reversedBy.id}`}>
              {je.reversedBy.jeNo}
            </Link>
          </p>
        ) : null}
      </div>

      {postedNo ? (
        <p role="status" className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30">
          Posted as {postedNo}.
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {je.lines.map((l) => (
            <TableRow key={l.lineNo}>
              <TableCell className="tabular-nums text-muted-foreground">{l.lineNo}</TableCell>
              <TableCell>
                <span className="font-mono text-xs">{l.code}</span> {l.name}
              </TableCell>
              <TableCell className="text-xs">{l.memberNo ? `${l.memberNo} · ${l.memberName}` : ""}</TableCell>
              <TableCell className="text-xs">{l.memo ?? ""}</TableCell>
              <TableCell className="text-right tabular-nums">{l.debit ? format(l.debit) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{l.credit ? format(l.credit) : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(dr)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(cr)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      {je.status === "DRAFT" ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Approval</h2>
          {can(access.user, "gl.jv_approve") && !isPreparer ? <ApproveJvButton jeId={je.id} /> : null}
          {isPreparer ? (
            <p className="text-sm text-muted-foreground">You prepared this JV. Another user with approval rights must post it.</p>
          ) : null}
          {can(access.user, "gl.jv_prepare") ? <DiscardJvButton jeId={je.id} /> : null}
        </section>
      ) : null}

      {je.status === "POSTED" && !je.reversalOfId && can(access.user, "gl.jv_approve") && isPreparer ? (
        <p className="text-sm text-muted-foreground">You prepared this entry. Another user with approval rights must reverse it.</p>
      ) : null}

      {je.status === "POSTED" && !je.reversalOfId && can(access.user, "gl.jv_approve") && !isPreparer ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Reverse this entry</h2>
          <p className="text-xs text-muted-foreground">
            Posted entries are never edited. A reversal posts the opposite entry; then record the correct one.
          </p>
          <ReverseJvForm jeId={je.id} today={businessToday()} />
        </section>
      ) : null}
    </div>
  );
}

export default function EntryPage(props: PageProps<"/accounting/journals/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EntryContent {...props} />
    </Suspense>
  );
}
