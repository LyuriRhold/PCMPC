import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { businessToday } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { postableAccounts } from "@/modules/ledger/queries";
import { JvForm } from "@/modules/ledger/ui/jv-form";

export const metadata: Metadata = { title: "New journal voucher · PCMPC MIS" };

async function NewJvContent() {
  const access = await guardPage("gl.jv_prepare");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const accounts = await postableAccounts();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/accounting/journals" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Journal vouchers
        </Link>
        <h1 className="text-2xl font-semibold">New journal voucher</h1>
        <p className="text-sm text-muted-foreground">
          General Journal. Debits must equal credits. Lines on member ledgers (share capital, savings, loans) need the
          member number.
        </p>
      </div>
      <JvForm accounts={accounts} today={businessToday()} />
    </div>
  );
}

export default function NewJvPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewJvContent />
    </Suspense>
  );
}
