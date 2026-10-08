import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { guardPage } from "@/lib/page-guard";
import { CustomerForm } from "@/modules/water/ui/forms";

export const metadata: Metadata = { title: "New water customer · PCMPC MIS" };

async function NewCustomerContent() {
  const access = await guardPage("water.customers");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/water/customers" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Water customers
        </Link>
        <h1 className="text-2xl font-semibold">New water customer</h1>
        <p className="text-sm text-muted-foreground">
          Register the customer first, then file a connection application from their profile.
        </p>
      </div>
      <CustomerForm />
    </div>
  );
}

export default function NewWaterCustomerPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewCustomerContent />
    </Suspense>
  );
}
