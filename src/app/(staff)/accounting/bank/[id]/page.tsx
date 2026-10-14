import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { AccountingError } from "@/modules/accounting/assets";
import { reconData } from "@/modules/accounting/bank";
import { ReconForm } from "@/modules/accounting/ui/forms";

export const metadata: Metadata = { title: "Reconcile · PCMPC MIS" };

async function ReconContent(props: PageProps<"/accounting/bank/[id]">) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await props.searchParams;
  const period = typeof sp.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : businessToday().slice(0, 7);
  let data;
  try {
    data = await reconData(id, period);
  } catch (e) {
    if (e instanceof AccountingError) notFound();
    throw e;
  }
  const { bank, saved } = data;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/accounting/bank" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Bank reconciliation
        </Link>
        <h1 className="text-2xl font-semibold">
          {bank.name} · {period}
        </h1>
        <p className="text-sm text-muted-foreground">
          {bank.bankName} · {bank.accountNo} · book balance on {formatDate(data.end)}: {format(data.bookBalance)}
        </p>
      </div>
      <form method="get" className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="period">Month</Label>
          <Input id="period" name="period" type="month" defaultValue={period} />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Show
        </Button>
      </form>
      {saved ? (
        <dl className="grid max-w-md grid-cols-2 gap-1 rounded-lg border p-3 text-sm">
          <dt className="col-span-2 font-medium">Reconciled</dt>
          <dt>Bank statement balance</dt>
          <dd className="text-right tabular-nums">{format(saved.bankBalance)}</dd>
          <dt>Add: deposits in transit</dt>
          <dd className="text-right tabular-nums">{format(saved.depositsInTransit)}</dd>
          <dt>Less: outstanding checks</dt>
          <dd className="text-right tabular-nums">{format(saved.outstandingChecks)}</dd>
          <dt>Book balance</dt>
          <dd className="text-right tabular-nums">{format(saved.bookBalance)}</dd>
          <dt>Bank-only items</dt>
          <dd className="text-right tabular-nums">{format(saved.adjustments)}</dd>
        </dl>
      ) : data.end > businessToday() ? (
        <p className="text-sm text-muted-foreground">{period} isn&apos;t over yet.</p>
      ) : can(access.user, "gl.jv_prepare") ? (
        <ReconForm
          bankAccountId={bank.id}
          period={period}
          monthEnd={data.end}
          bookBalance={String(data.bookBalance)}
          open={data.open.map((l) => ({ id: l.id, date: l.date, label: `${l.jeNo ?? ""} ${l.reference ?? l.particulars}`.trim(), debit: String(l.debit), credit: String(l.credit) }))}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Not reconciled yet.</p>
      )}
    </div>
  );
}

export default function ReconPage(props: PageProps<"/accounting/bank/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReconContent {...props} />
    </Suspense>
  );
}
