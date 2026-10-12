import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { LOAN_APPLICATION_STATUSES } from "@/modules/loans/schema";
import { applicationRegistry } from "@/modules/loans/service";

export const metadata: Metadata = { title: "Loan applications · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());
const QUEUES: Array<{ status?: (typeof LOAN_APPLICATION_STATUSES)[number]; label: string }> = [
  { status: "SUBMITTED", label: "Waiting for the manager" },
  { status: "RECOMMENDED", label: "Waiting for the Credit Committee" },
  { status: "APPROVED", label: "Approved" },
  { label: "All" },
];

async function ApplicationsContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const f = z.object({ status: one.pipe(z.enum(LOAN_APPLICATION_STATUSES).optional().catch(undefined)), all: one, q: one }).parse(await searchParams);
  const defaultQueue = can(access.user, "loans.recommend") ? "SUBMITTED" : can(access.user, "loans.approve") ? "RECOMMENDED" : undefined;
  const status = f.all ? undefined : (f.status ?? defaultQueue);
  const rows = await applicationRegistry({ status, q: f.q });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Loan applications</h1>
          <p className="text-sm text-muted-foreground">
            The manager reviews each application; up to the manager&apos;s limit that approves it, above it the Credit Committee decides.
          </p>
        </div>
        {can(access.user, "loans.apply") ? (
          <Button nativeButton={false} render={<Link href="/loans/applications/new" />}>
            New application
          </Button>
        ) : null}
      </div>
      <nav aria-label="Queues" className="flex flex-wrap gap-2 text-sm">
        {QUEUES.map((q) => {
          const active = q.status ? status === q.status : status === undefined;
          return (
            <Link key={q.label} href={q.status ? `/loans/applications?status=${q.status}` : "/loans/applications?all=1"} aria-current={active ? "page" : undefined} className={`rounded-full border px-3 py-1 ${active ? "border-primary font-medium" : "text-muted-foreground"}`}>
              {q.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {status ? <input type="hidden" name="status" value={status} /> : <input type="hidden" name="all" value="1" />}
        <div className="flex min-w-60 flex-col gap-1.5">
          <Label htmlFor="q">Search name, member no. or application no.</Label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} />
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application</TableHead>
            <TableHead>Borrower</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Term</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No applications.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((r) => (
            <TableRow key={r.application.id}>
              <TableCell>
                <Link href={`/loans/applications/${r.application.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {r.application.appNo}
                </Link>
              </TableCell>
              <TableCell>
                {r.lastName}, {r.firstName} <span className="font-mono text-xs text-muted-foreground">{r.memberNo}</span>
              </TableCell>
              <TableCell>{r.productName}</TableCell>
              <TableCell className="text-right tabular-nums">{format(r.application.amount)}</TableCell>
              <TableCell>{r.application.term} mo.</TableCell>
              <TableCell>
                <Badge variant="outline">{r.application.status}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">{formatDateTime(r.application.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function LoanApplicationsPage(props: PageProps<"/loans/applications">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApplicationsContent searchParams={props.searchParams} />
    </Suspense>
  );
}
