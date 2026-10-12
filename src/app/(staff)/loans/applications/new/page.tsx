import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { businessToday } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { listLoanProducts } from "@/modules/loans/service";
import { ApplicationForm } from "@/modules/loans/ui/loan-forms";
import { productOption } from "@/modules/loans/ui/options";

export const metadata: Metadata = { title: "New loan application · PCMPC MIS" };

async function NewApplicationContent() {
  const access = await guardPage("loans.apply");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const products = await listLoanProducts(undefined, true);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/loans/applications" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Loan applications
        </Link>
        <h1 className="text-2xl font-semibold">New loan application</h1>
        <p className="text-sm text-muted-foreground">The eligibility rules are checked when you submit; the manager then reviews it.</p>
      </div>
      <ApplicationForm products={products.map(productOption)} today={businessToday()} />
    </div>
  );
}

export default function NewApplicationPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewApplicationContent />
    </Suspense>
  );
}
