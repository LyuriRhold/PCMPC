import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import "@/modules/cashiering/builtins";
import { approvedDvCount, sessionReceipts } from "@/modules/cashiering/queries";
import { payorTypeList } from "@/modules/cashiering/registry";
import { currentSession, sessionTotals } from "@/modules/cashiering/service";
import { BankDepositForm, OpenSessionForm, ReceiptBuilder } from "@/modules/cashiering/ui/teller-desk";
import { getSetting } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Teller counter · PCMPC MIS" };

async function TellerContent() {
  const access = await guardPage("cash.session");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const session = await currentSession(access.user.id);
  const today = businessToday();

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Teller counter</h1>
        <OpenSessionForm />
      </div>
    );
  }

  const [totals, receipts, incomeItems, requireBir, dvsToRelease] = await Promise.all([
    sessionTotals(session.id),
    sessionReceipts(session.id),
    getSetting("cash.other_income_items"),
    getSetting("cash.require_bir_receipt_no"),
    approvedDvCount(),
  ]);
  const usable = session.status === "OPEN" && session.businessDate === today;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Teller counter</h1>
          <p className="text-sm text-muted-foreground">
            {usable ? (
              <Badge variant="outline" className="mr-2 border-green-600/40 text-green-700">
                Session open
              </Badge>
            ) : (
              <Badge variant="secondary" className="mr-2">
                Session {session.status}
              </Badge>
            )}
            {formatDate(session.businessDate)} · opening {format(session.openingCash)} · received {format(totals.receiptsIn)} · paid out{" "}
            {format(totals.cashOut)} · <span className="font-medium text-foreground">expected in drawer {format(totals.expected)}</span>
          </p>
        </div>
        {session.status === "OPEN" ? (
          <Button variant="outline" nativeButton={false} render={<Link href="/cashiering/teller/close" />}>
            Count cash and close session
          </Button>
        ) : null}
      </div>

      {session.status === "OPEN" && session.businessDate !== today ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          This session is from {formatDate(session.businessDate)}. Close it before taking today&apos;s payments.
        </p>
      ) : null}

      {usable ? (
        <>
          <ReceiptBuilder
            payorTypes={payorTypeList().map((p) => ({ type: p.type, label: p.label, freeText: !!p.freeText }))}
            incomeItems={incomeItems.map((i) => ({ code: i.code, label: i.label }))}
            requireBir={requireBir}
          />
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Cash out</h2>
            <p className="text-sm text-muted-foreground">
              {dvsToRelease > 0 ? (
                <>
                  <Link className="underline" href="/cashiering/vouchers?status=APPROVED">
                    {dvsToRelease} approved disbursement voucher{dvsToRelease === 1 ? "" : "s"}
                  </Link>{" "}
                  waiting for release.
                </>
              ) : (
                "No approved disbursement vouchers to release."
              )}
            </p>
            <BankDepositForm />
          </section>
        </>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Receipts in this session ({receipts.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt no.</TableHead>
              <TableHead>BIR no.</TableHead>
              <TableHead>Payor</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  <Link className="hover:underline" href={`/cashiering/receipts/${r.id}`}>
                    {r.receiptNo}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{r.birReceiptNo ?? ""}</TableCell>
                <TableCell>{r.payorName}</TableCell>
                <TableCell className="text-xs">{r.mode}</TableCell>
                <TableCell className="text-right tabular-nums">{format(r.total)}</TableCell>
                <TableCell className="text-xs">{r.status}</TableCell>
                <TableCell className="text-xs tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

export default function TellerPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TellerContent />
    </Suspense>
  );
}
