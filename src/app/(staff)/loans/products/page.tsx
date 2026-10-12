import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { listLoanProducts } from "@/modules/loans/service";
import { LoanProductForm } from "@/modules/loans/ui/loan-forms";
import { pct } from "@/modules/loans/ui/options";
import { METHOD_LABEL } from "@/modules/loans/ui/schedule-table";

export const metadata: Metadata = { title: "Loan products · PCMPC MIS" };

const pesos = (m: bigint) => format(m).replace("₱", "").replaceAll(",", "");

async function LoanProductsContent() {
  const access = await guardPageAny(["loans.read", "admin.settings"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const products = await listLoanProducts();
  const canEdit = can(access.user, "admin.settings");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Loan products</h1>
        <p className="text-sm text-muted-foreground">
          Rates, terms, limits and the deductions taken on release. Changes apply to new applications; submitted ones keep the terms they were submitted on.
          {canEdit ? "" : " Only the administrator can change them."}
        </p>
      </div>
      {products.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {p.name}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {p.code} · {METHOD_LABEL[p.method]}
                {p.isActive ? "" : " · not offered"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <LoanProductForm
                product={{
                  id: p.id,
                  name: p.name,
                  ratePct: pct(p.ratePm),
                  minTerm: p.minTerm,
                  maxTerm: p.maxTerm,
                  minAmount: pesos(p.minAmount),
                  maxAmount: p.maxAmount === null ? "" : pesos(p.maxAmount),
                  maxMultipleOfPaidUp: p.maxMultipleOfPaidUp ?? "",
                  requiredComakers: p.requiredComakers,
                  penaltyPct: pct(p.penaltyRatePm),
                  graceDays: p.graceDays,
                  isActive: p.isActive,
                  deductions: p.deductions.map((d) => ({ code: d.code, name: d.name, basis: d.basis, value: d.basis === "PCT_OF_PRINCIPAL" ? pct(d.value) : pesos(BigInt(d.value)), glKey: d.glKey })),
                }}
              />
            ) : (
              <p className="text-sm">
                {pct(p.ratePm)}% a month · {p.minTerm}–{p.maxTerm} months · from {format(p.minAmount)}
                {p.maxAmount !== null ? ` up to ${format(p.maxAmount)}` : ""}
                {p.maxMultipleOfPaidUp ? ` · up to ${p.maxMultipleOfPaidUp}× paid-up share capital` : ""} · {p.requiredComakers} comaker(s) · penalty {pct(p.penaltyRatePm)}% a month after {p.graceDays} days
                <br />
                Deductions: {p.deductions.length ? p.deductions.map((d) => `${d.name} ${d.basis === "PCT_OF_PRINCIPAL" ? `${pct(d.value)}%` : format(BigInt(d.value))}`).join(" · ") : "none"}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function LoanProductsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <LoanProductsContent />
    </Suspense>
  );
}
