import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/auth-guard";
import { addMonths, businessToday, isBusinessDate } from "@/lib/dates";
import { format, parse } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import { listLoanProducts, previewLoan } from "@/modules/loans/service";
import { pct } from "@/modules/loans/ui/options";
import { METHOD_LABEL, ScheduleTable } from "@/modules/loans/ui/schedule-table";

export const metadata: Metadata = { title: "Loan calculator · PCMPC MIS" };

const one = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional());

async function CalculatorContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Open to all staff (no member data).
  if (!(await getCurrentUser())) redirect("/login");
  const sp = z.object({ product: one, amount: one, term: one, first: one }).parse(await searchParams);
  const products = await listLoanProducts(undefined, true);
  const product = products.find((p) => p.id === sp.product) ?? products[0];
  const firstDue = sp.first && isBusinessDate(sp.first) ? sp.first : addMonths(businessToday(), 1);
  let amount: bigint | null = null;
  try {
    amount = sp.amount ? parse(sp.amount) : null;
  } catch {
    amount = null;
  }
  const term = sp.term && /^\d{1,3}$/.test(sp.term) ? Number(sp.term) : null;
  let result: ReturnType<typeof previewLoan> | null = null;
  let error: string | null = null;
  if (product && sp.amount && amount === null) error = "Enter the amount in pesos, e.g. 10,000.00";
  else if (product && amount !== null && term === null) error = "Enter the term in months";
  else if (product && amount !== null && term !== null) {
    if (term < product.minTerm || term > product.maxTerm) error = `${product.name}: the term is ${product.minTerm} to ${product.maxTerm} months`;
    else if (amount < product.minAmount || (product.maxAmount !== null && amount > product.maxAmount)) {
      error = `${product.name}: from ${format(product.minAmount)}${product.maxAmount !== null ? ` up to ${format(product.maxAmount)}` : ""}`;
    } else {
      try {
        result = previewLoan(product, { amount, term, firstDueDate: firstDue });
      } catch (e) {
        error = e instanceof Error ? e.message : "Can't compute this loan";
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Loan calculator</h1>
        <p className="text-sm text-muted-foreground">Monthly payments, the repayment schedule and the net proceeds for a loan product. Nothing is saved.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product">Product</Label>
          <select id="product" name="product" defaultValue={product?.id} className={selectClass}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="amount">Amount (₱)</Label>
          <Input id="amount" name="amount" defaultValue={sp.amount ?? ""} inputMode="decimal" className="w-36" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term">Term (months)</Label>
          <Input id="term" name="term" defaultValue={sp.term ?? ""} inputMode="numeric" className="w-28" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first">First due date</Label>
          <Input id="first" name="first" type="date" defaultValue={firstDue} />
        </div>
        <Button type="submit">Compute</Button>
      </form>
      {product ? (
        <p className="text-xs text-muted-foreground">
          {product.name}: {METHOD_LABEL[product.method]} · {pct(product.ratePm)}% a month · {product.minTerm}–{product.maxTerm} months · from {format(product.minAmount)}
          {product.maxAmount !== null ? ` up to ${format(product.maxAmount)}` : ""}
          {product.maxMultipleOfPaidUp ? ` · up to ${product.maxMultipleOfPaidUp}× paid-up share capital` : ""}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Monthly payment</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="calc-payment">
                  {format(result.regularPayment)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Total interest</p>
                <p className="text-lg font-semibold tabular-nums">{format(result.totalInterest)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Deductions · net proceeds</p>
                <p className="text-lg font-semibold tabular-nums">
                  {format(result.totalDeductions)} · {format(result.net)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Effective interest rate (as on the disclosure)</p>
                <p className="text-lg font-semibold tabular-nums">
                  {pct(result.effectiveRatePm)}% a month
                </p>
              </div>
            </div>
            {result.deductions.length ? (
              <p className="text-sm">
                Deducted on release: {result.deductions.map((d) => `${d.name} ${format(d.amount)}`).join(" · ")}
              </p>
            ) : null}
            <ScheduleTable rows={result.rows} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function LoanCalculatorPage(props: PageProps<"/loans/calculator">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CalculatorContent searchParams={props.searchParams} />
    </Suspense>
  );
}
