import Decimal from "decimal.js";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { effectiveRateOf, getApplication } from "@/modules/loans/service";
import { pct } from "@/modules/loans/ui/options";
import { METHOD_LABEL, ScheduleTable } from "@/modules/loans/ui/schedule-table";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Disclosure statement · PCMPC MIS" };

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 border-b py-1 text-sm ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Disclosure statement (Truth in Lending Act, RA 3765): the amount, the finance charges deducted
 * and in interest, the net proceeds, the effective interest rate and the repayment schedule
 * (CONFIRM Q-10.4 for PCMPC's own form). CBU is the member's own share capital, so it is shown as
 * a deduction but not as a finance charge.
 */
async function DisclosureContent(props: PageProps<"/loans/applications/[id]/disclosure">) {
  const access = await guardPage("loans.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getApplication(id);
  if (!data) notFound();
  const { application: a, product, member } = data;
  if (a.status === "REJECTED" || a.status === "CANCELLED") {
    return (
      <div className="flex flex-col gap-2">
        <Link href={`/loans/applications/${a.id}`} className="text-sm text-muted-foreground underline underline-offset-4">
          ← {a.appNo}
        </Link>
        <p role="status" className="text-sm">There is no disclosure statement for a {a.status.toLowerCase()} application.</p>
      </div>
    );
  }
  const coop = await getSetting("coop.name");
  const fees = a.deductions.filter((d) => d.code !== "CBU");
  const others = a.deductions.filter((d) => d.code === "CBU");
  const feeTotal = fees.reduce((s, d) => s + BigInt(d.amount), 0n);
  const financeCharge = feeTotal + a.totalInterest;
  const amountFinanced = a.amount - feeTotal;
  const payments = a.schedulePreview.map((r) => BigInt(r.payment));
  const eir = effectiveRateOf(a.amount, a.deductions.map((d) => ({ code: d.code, amount: BigInt(d.amount) })), payments);
  const approvedAt = data.approvals.find((x) => x.resultingStatus === "APPROVED")?.at ?? null;
  const final = a.status === "APPROVED" || a.status === "RELEASED";
  const rows = a.schedulePreview.map((r) => ({ no: r.no, dueDate: r.dueDate, principal: BigInt(r.principal), interest: BigInt(r.interest), payment: BigInt(r.payment), balance: BigInt(r.balance) }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/loans/applications/${a.id}`} className="text-sm text-muted-foreground underline underline-offset-4">
          ← {a.appNo}
        </Link>
        <PrintButton />
      </div>
      {!final ? (
        <p role="status" className="rounded border border-amber-500/60 p-2 text-center text-sm font-medium text-amber-800 dark:text-amber-300">
          PREVIEW: the application is {a.status.toLowerCase()} and not yet approved.
        </p>
      ) : null}
      <div className="text-center">
        <p className="font-semibold">{coop}</p>
        <h1 className="text-xl font-semibold">Disclosure Statement on Loan Transaction</h1>
        <p className="text-xs text-muted-foreground">As required under Republic Act No. 3765 (Truth in Lending Act)</p>
      </div>
      <div className="grid gap-x-8 text-sm sm:grid-cols-2">
        <p>
          Borrower: <span className="font-medium">{member.lastName}, {member.firstName}</span> ({member.memberNo})
        </p>
        <p>Application: {a.appNo}</p>
        <p>Loan: {product.name} · {METHOD_LABEL[a.method]}</p>
        <p>{approvedAt ? `Approved: ${formatDateTime(approvedAt)}` : `Printed: ${formatDate(businessToday())}`}</p>
      </div>
      <div className="flex flex-col">
        <Line label="1. Amount of the loan" value={format(a.amount)} />
        <Line label="2. Finance charges deducted from the loan" value="" />
        {fees.map((d) => (
          <Line key={d.code + d.name} label={`    ${d.name}`} value={format(BigInt(d.amount))} />
        ))}
        <Line label="3. Amount financed (1 − 2)" value={format(amountFinanced)} strong />
        <Line label={`4. Interest (${pct(a.ratePm)}% a month for ${a.term} months)`} value={format(a.totalInterest)} />
        <Line label="5. Total finance charge (2 + 4)" value={format(financeCharge)} strong />
        <Line label="6. Other deductions (not finance charges)" value="" />
        {others.map((d) => (
          <Line key={d.code + d.name} label={`    ${d.name} (credited to your share capital)`} value={format(BigInt(d.amount))} />
        ))}
        <Line label="7. Net proceeds you receive" value={format(a.netProceeds)} strong />
        <Line label="8. Effective interest rate (on the unpaid balance)" value={`${pct(eir)}% a month, ${pct(new Decimal(eir).mul(12).toFixed())}% a year (simple annual rate)`} strong />
        <Line label={`9. Total of ${a.term} payments`} value={format(payments.reduce((s, p) => s + p, 0n))} />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Repayment schedule (the due dates are set on release)</p>
        <ScheduleTable rows={rows} />
      </div>
      <p className="text-xs text-muted-foreground">
        Late payments are charged {pct(a.penaltyRatePm)}% a month on the overdue amount after {a.graceDays} grace days.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-10 text-center text-sm">
        <div>
          <div className="border-t pt-1">Borrower&apos;s signature over printed name</div>
        </div>
        <div>
          <div className="border-t pt-1">For the cooperative</div>
        </div>
      </div>
    </div>
  );
}

export default function DisclosurePage(props: PageProps<"/loans/applications/[id]/disclosure">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <DisclosureContent {...props} />
    </Suspense>
  );
}
