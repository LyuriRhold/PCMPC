import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { currentSession, sessionTotals } from "@/modules/cashiering/service";
import { CashCountForm } from "@/modules/cashiering/ui/cash-count";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Close session · PCMPC MIS" };

async function CloseContent() {
  const access = await guardPage("cash.session");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const session = await currentSession(access.user.id);
  if (!session || session.status !== "OPEN") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Close session</h1>
        <p className="text-sm text-muted-foreground">You have no open session.</p>
        <Link className="text-sm underline" href="/cashiering/teller">
          ← Teller counter
        </Link>
      </div>
    );
  }
  const [totals, denominations] = await Promise.all([sessionTotals(session.id), getSetting("cash.denominations")]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/cashiering/teller">
          ← Teller counter
        </Link>
        <h1 className="text-2xl font-semibold">Count cash and close session</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(session.businessDate)} · opening {format(session.openingCash)} + received {format(totals.receiptsIn)} − paid out{" "}
          {format(totals.cashOut)} = expected {format(totals.expected)}. Checks received count as cash on hand.
        </p>
      </div>
      <CashCountForm sessionId={session.id} denominations={denominations} expected={String(totals.expected)} />
    </div>
  );
}

export default function ClosePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CloseContent />
    </Suspense>
  );
}
