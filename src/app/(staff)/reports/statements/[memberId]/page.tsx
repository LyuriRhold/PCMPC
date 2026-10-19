import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { members } from "@/modules/members/schema";
import { memberSoa } from "@/modules/reports/soa";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Statement of account · PCMPC MIS" };

async function SoaContent(props: PageProps<"/reports/statements/[memberId]">) {
  const access = await guardPageAny(["members.read", "reports.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { memberId } = await props.params;
  if (!z.uuid().safeParse(memberId).success) notFound();
  const [m] = await getDb().select({ id: members.id }).from(members).where(eq(members.id, memberId));
  if (!m) notFound();
  const [soa, coop] = [await memberSoa(memberId), await getSetting("coop.name")];
  const off = soa.reconciliation.filter((r) => r.difference !== 0n);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/reports/statements" className="text-sm underline underline-offset-4">
          Member statements
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/api/reports/statements/${memberId}`} className="underline underline-offset-4">
            PDF
          </a>
          <PrintButton />
        </div>
      </div>
      <div>
        <p className="font-semibold">{coop}</p>
        <h1 className="text-xl font-semibold">Statement of account as of {formatDate(soa.asOf)}</h1>
        <p className="text-sm">
          <span className="font-mono">{soa.member.memberNo}</span> · {soa.member.name} · {soa.member.type === "ASSOCIATE" ? "Associate" : "Regular"} member
          {soa.member.membershipDate ? ` since ${formatDate(soa.member.membershipDate)}` : ""}
        </p>
      </div>

      <h2 className="font-semibold">Share capital</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">Subscribed</TableHead>
            <TableHead className="text-right">Paid-up</TableHead>
            <TableHead className="text-right">Unpaid subscription</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-right tabular-nums">{format(soa.share.subscribed)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(soa.share.paidUp)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(soa.share.unpaid)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <h2 className="font-semibold">Savings and time deposits</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Status / matures</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {soa.savings.length + soa.timeDeposits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-sm text-muted-foreground">
                No savings account or time deposit.
              </TableCell>
            </TableRow>
          ) : null}
          {soa.savings.map((a) => (
            <TableRow key={a.accountNo}>
              <TableCell className="font-mono text-xs">{a.accountNo}</TableCell>
              <TableCell>{a.product}</TableCell>
              <TableCell>{a.status}</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.balance)}</TableCell>
            </TableRow>
          ))}
          {soa.timeDeposits.map((t) => (
            <TableRow key={t.certificateNo}>
              <TableCell className="font-mono text-xs">{t.certificateNo}</TableCell>
              <TableCell>Time deposit</TableCell>
              <TableCell>{formatDate(t.maturityDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(t.principal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h2 className="font-semibold">Loans</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loan</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Principal balance</TableHead>
            <TableHead className="text-right">Unpaid interest</TableHead>
            <TableHead className="text-right">Penalties</TableHead>
            <TableHead className="text-right">Past due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {soa.loans.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                No open loan.
              </TableCell>
            </TableRow>
          ) : null}
          {soa.loans.map((l) => (
            <TableRow key={l.loanNo}>
              <TableCell className="font-mono text-xs">{l.loanNo}</TableCell>
              <TableCell>{l.product}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.outstandingPrincipal)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.unpaidInterest)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.unpaidPenalty)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {format(l.arrears)}
                {l.daysPastDue ? ` (${l.daysPastDue} days)` : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h2 className="font-semibold">Store account</h2>
      <p className="text-sm">{soa.storeAr === 0n ? "Nothing owed to the store." : `Owed to the store: ${format(soa.storeAr)}`}</p>

      <div className="text-xs text-muted-foreground print:hidden">
        <p className="font-semibold">Checked against the books</p>
        {soa.reconciliation.map((r) => (
          <p key={r.label} className={r.difference === 0n ? "" : "text-destructive"}>
            {r.label}: books {format(r.gl)} · member records {format(r.subsidiary)}
            {r.difference === 0n ? "" : ` · difference ${format(r.difference)}`}
          </p>
        ))}
        {off.length ? null : <p>Every balance agrees with the books.</p>}
      </div>
    </div>
  );
}

export default function SoaPage(props: PageProps<"/reports/statements/[memberId]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SoaContent {...props} />
    </Suspense>
  );
}
