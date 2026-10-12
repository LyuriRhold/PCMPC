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
import { formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getApplication } from "@/modules/loans/service";
import { CancelApplicationForm, DecisionForm } from "@/modules/loans/ui/loan-forms";
import { pct } from "@/modules/loans/ui/options";
import { METHOD_LABEL, ScheduleTable } from "@/modules/loans/ui/schedule-table";

export const metadata: Metadata = { title: "Loan application · PCMPC MIS" };

const RULE_LABEL: Record<string, string> = { member: "Member status", amount: "Loanable amount", term: "Term", "past-due": "Past-due loans", comakers: "Comakers" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

async function ApplicationContent(props: PageProps<"/loans/applications/[id]">) {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getApplication(id);
  if (!data) notFound();
  const { application: a, product, member, comakers, approvals } = data;
  const user = access.user;
  const canRecommend = can(user, "loans.recommend");
  const decidedBefore = approvals.some((x) => x.by === user.id);
  const canDecide = can(user, "loans.approve") && user.id !== a.encodedBy && !decidedBefore && ((canRecommend && a.status === "SUBMITTED") || (!canRecommend && a.status === "RECOMMENDED"));
  const canCancel = can(user, "loans.apply") && user.id === a.encodedBy && (a.status === "SUBMITTED" || a.status === "RECOMMENDED");
  const rows = a.schedulePreview.map((r) => ({ no: r.no, dueDate: r.dueDate, principal: BigInt(r.principal), interest: BigInt(r.interest), payment: BigInt(r.payment), balance: BigInt(r.balance) }));
  const deductionTotal = a.deductions.reduce((s, d) => s + BigInt(d.amount), 0n);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/loans/applications" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Loan applications
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Loan application {a.appNo}</h1>
          <span className="rounded-full border px-3 py-0.5 text-sm font-medium" data-testid="application-status">
            {a.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Submitted {formatDateTime(a.createdAt)} by {data.encodedBy} ·{" "}
          <Link href={`/loans/applications/${a.id}/disclosure`} className="underline underline-offset-4">
            Disclosure statement
          </Link>
        </p>
      </div>

      {canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>{canRecommend ? "Manager review" : "Credit Committee decision"}</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionForm applicationId={a.id} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <dl className="divide-y rounded-lg border px-4 py-2">
          <Row
            label="Borrower"
            value={
              <Link href={`/members/${member.id}`} className="underline-offset-4 hover:underline">
                {member.lastName}, {member.firstName} ({member.memberNo})
              </Link>
            }
          />
          <Row label="Product" value={`${product.name} · ${METHOD_LABEL[a.method]}`} />
          <Row label="Amount" value={format(a.amount)} />
          <Row label="Term" value={`${a.term} months at ${pct(a.ratePm)}% a month`} />
          <Row label="Purpose" value={a.purpose} />
          <Row label="Comakers" value={comakers.length ? comakers.map((c) => `${c.lastName}, ${c.firstName} (${c.memberNo})`).join("; ") : "None"} />
          <Row label="Total interest" value={format(a.totalInterest)} />
          <Row label="Deductions" value={a.deductions.length ? `${a.deductions.map((d) => `${d.name} ${format(BigInt(d.amount))}`).join(" · ")} = ${format(deductionTotal)}` : "None"} />
          <Row label="Net proceeds" value={<span className="font-semibold">{format(a.netProceeds)}</span>} />
        </dl>
        <div className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eligibility rule (at submission)</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.eligibility.map((r) => (
                <TableRow key={r.rule}>
                  <TableCell>{RULE_LABEL[r.rule] ?? r.rule}</TableCell>
                  <TableCell className={r.pass ? "" : "text-destructive"}>
                    {r.pass ? "✓ " : "✗ "}
                    {r.message}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Decision</TableHead>
                <TableHead>By</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">
                    No decision yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {approvals.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    {x.level === "MANAGER" ? "Manager" : "Credit Committee"}: {x.decision === "REJECT" ? "rejected" : x.resultingStatus === "RECOMMENDED" ? "recommended to the Credit Committee" : "approved"}
                    {x.remarks ? <div className="text-xs text-muted-foreground">{x.remarks}</div> : null}
                  </TableCell>
                  <TableCell>{x.byName}</TableCell>
                  <TableCell className="tabular-nums">{formatDateTime(x.at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repayment schedule (preview from {formatDate(a.firstDueDate)}; the release sets the real dates)</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleTable rows={rows} />
        </CardContent>
      </Card>

      {canCancel ? <CancelApplicationForm applicationId={a.id} /> : null}
    </div>
  );
}

export default function LoanApplicationPage(props: PageProps<"/loans/applications/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApplicationContent {...props} />
    </Suspense>
  );
}
