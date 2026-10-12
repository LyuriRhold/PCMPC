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
import { addMonths, businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getLoan } from "@/modules/loans/servicing";
import { pct } from "@/modules/loans/ui/options";
import { METHOD_LABEL } from "@/modules/loans/ui/schedule-table";
import { PayFromSavingsForm, PayOutButton, RestructureForm, WriteOffForm } from "@/modules/loans/ui/servicing-forms";
import { depositableAccounts } from "@/modules/savings/service";

export const metadata: Metadata = { title: "Loan · PCMPC MIS" };

const STATUS: Record<string, string> = { OPEN: "Open", PARTIAL: "Partial", PAID: "Paid" };
const KIND: Record<string, string> = { PAYMENT: "Payment", OFFSET: "Offset", RECOVERY: "Recovery" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

async function LoanContent(props: PageProps<"/loans/[id]">) {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getLoan(id);
  if (!data) notFound();
  const { loan, member, schedule: rows, payments } = data;
  const user = access.user;
  const open = loan.status === "ACTIVE" || loan.status === "PAST_DUE";
  const accounts = open && can(user, "loans.collect") && can(user, "savings.post") ? await depositableAccounts(member.id) : [];
  const today = businessToday();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/loans/servicing" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Releases &amp; collections
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Loan {loan.loanNo}</h1>
          <span className="rounded-full border px-3 py-0.5 text-sm font-medium" data-testid="loan-status">
            {loan.status}
          </span>
          {data.daysPastDue > 0 ? <span className="text-sm text-destructive">{data.daysPastDue} days past due</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/members/${member.id}?tab=loans`} className="underline underline-offset-4">
            {member.lastName}, {member.firstName} ({member.memberNo})
          </Link>
          {loan.applicationId ? (
            <>
              {" · "}
              <Link href={`/loans/applications/${loan.applicationId}`} className="underline underline-offset-4">
                application
              </Link>
            </>
          ) : null}
          {data.restructuredInto ? (
            <>
              {" · restructured into "}
              <Link href={`/loans/${data.restructuredInto.id}`} className="underline underline-offset-4">
                {data.restructuredInto.loanNo}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Outstanding principal</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="loan-outstanding">
            {format(data.outstandingPrincipal)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Due now (incl. penalties)</p>
          <p className="text-lg font-semibold tabular-nums">{format(data.dueNow)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Unpaid penalties</p>
          <p className="text-lg font-semibold tabular-nums">{format(data.unpaidPenalty)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Interest still scheduled</p>
          <p className="text-lg font-semibold tabular-nums">{format(data.unpaidInterest)}</p>
        </div>
      </div>

      {loan.status === "PENDING" && loan.disbursement === "CASH" && can(user, "cash.session") ? <PayOutButton loanId={loan.id} loanNo={loan.loanNo} net={String(loan.netProceeds)} /> : null}
      {loan.status === "PENDING" ? <p className="text-sm text-muted-foreground">Authorized; waiting for the teller to pay out {format(loan.netProceeds)}.</p> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <dl className="divide-y rounded-lg border px-4 py-2">
          <Row label="Principal" value={format(loan.principal)} />
          <Row label="Terms" value={`${METHOD_LABEL[loan.method]} · ${pct(loan.ratePm)}% a month · ${loan.term} months`} />
          <Row label="Released" value={loan.releaseDate ? `${formatDate(loan.releaseDate)} (${loan.disbursement === "SAVINGS" ? "to savings" : loan.disbursement === "RESTRUCTURE" ? "restructure" : "cash"})` : "Not yet"} />
          <Row label="Due" value={`${formatDate(loan.firstDueDate)} to ${formatDate(loan.maturityDate)}`} />
          <Row label="Deductions" value={loan.deductions.length ? `${loan.deductions.map((d) => `${d.name} ${format(BigInt(d.amount))}`).join(" · ")}` : "None"} />
          <Row label="Net proceeds" value={format(loan.netProceeds)} />
          <Row label="Penalty" value={`${pct(loan.penaltyRatePm)}% a month after ${loan.graceDays} grace days`} />
          {loan.writeOffRef ? <Row label="Written off" value={`${loan.writeOffRef} on ${loan.closedAt ? formatDate(loan.closedAt) : ""}`} /> : null}
        </dl>
        {open ? (
          <div className="flex flex-col gap-4">
            {accounts.length ? <PayFromSavingsForm loanId={loan.id} accounts={accounts.map((a) => ({ id: a.id, accountNo: a.accountNo }))} /> : null}
            {can(user, "loans.release") ? <RestructureForm loanId={loan.id} defaultFirstDue={addMonths(today, 1)} /> : null}
            {can(user, "loans.writeoff") ? <WriteOffForm loanId={loan.id} /> : null}
            <p className="text-xs text-muted-foreground">Payments are collected at the teller counter.</p>
          </div>
        ) : null}
      </div>

      {rows.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Installments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Penalty</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.no}>
                    <TableCell className="tabular-nums">{r.no}</TableCell>
                    <TableCell className="tabular-nums">{formatDate(r.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(r.principalDue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(r.interestDue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.penaltyAccrued > 0n ? format(r.penaltyAccrued) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(r.principalPaid + r.interestPaid + r.penaltyPaid)}</TableCell>
                    <TableCell>{STATUS[r.status]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Penalty</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Principal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No payments yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {payments.map((p) => (
                <TableRow key={p.id} className={p.reversedBy ? "text-muted-foreground line-through" : ""}>
                  <TableCell className="tabular-nums">{formatDate(p.payDate)}</TableCell>
                  <TableCell>
                    {KIND[p.kind]}
                    {p.reversedBy ? " (reversed)" : ""}
                    {p.remarks ? <div className="text-xs text-muted-foreground">{p.remarks}</div> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.refNo ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(p.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(p.penaltyPart)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(p.interestPart)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(p.principalPart)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoanPage(props: PageProps<"/loans/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <LoanContent {...props} />
    </Suspense>
  );
}
