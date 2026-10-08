import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { businessToday } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { DvForm } from "@/modules/cashiering/ui/dv-form";
import { postableAccounts } from "@/modules/ledger/queries";

export const metadata: Metadata = { title: "New disbursement voucher · PCMPC MIS" };

async function NewDvContent() {
  const access = await guardPage("cash.dv_prepare");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const accounts = await postableAccounts();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/cashiering/vouchers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Disbursement vouchers
        </Link>
        <h1 className="text-2xl font-semibold">New disbursement voucher</h1>
        <p className="text-sm text-muted-foreground">Another user approves it; a teller releases cash DVs from the counter.</p>
      </div>
      <DvForm accounts={accounts} today={businessToday()} />
    </div>
  );
}

export default function NewDvPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewDvContent />
    </Suspense>
  );
}
