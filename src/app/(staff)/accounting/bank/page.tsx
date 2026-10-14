import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { can } from "@/lib/auth-guard";
import { addMonths, businessToday } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { listBankAccounts } from "@/modules/accounting/bank";
import { fsLineAccounts, fsLines } from "@/modules/accounting/schema";
import { BankAccountForm } from "@/modules/accounting/ui/forms";
import { accounts } from "@/modules/ledger/schema";

export const metadata: Metadata = { title: "Bank reconciliation · PCMPC MIS" };

async function BankContent() {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const banks = await listBankAccounts();
  const lastMonth = addMonths(`${businessToday().slice(0, 7)}-01`, -1).slice(0, 7);
  const cash = await getDb()
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(fsLineAccounts)
    .innerJoin(fsLines, eq(fsLines.id, fsLineAccounts.fsLineId))
    .innerJoin(accounts, eq(accounts.id, fsLineAccounts.accountId))
    .where(eq(fsLines.cashFlow, "CASH"));
  const free = cash.filter((c) => !banks.some((b) => b.bank.glAccountId === c.id));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Bank reconciliation</h1>
        <p className="text-sm text-muted-foreground">Each bank account has its own cash account in the books. Every month, reconcile it with the bank statement; the month-close checklist needs it.</p>
      </div>
      {can(access.user, "gl.coa") && free.length ? <BankAccountForm cashAccounts={free.map((c) => ({ id: c.id, label: `${c.code} ${c.name}` }))} /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bank account</TableHead>
            <TableHead>Bank · account no.</TableHead>
            <TableHead>GL account</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {banks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No bank accounts yet.
              </TableCell>
            </TableRow>
          ) : null}
          {banks.map(({ bank, glCode, glName }) => (
            <TableRow key={bank.id}>
              <TableCell>{bank.name}</TableCell>
              <TableCell>
                {bank.bankName} · {bank.accountNo}
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs">{glCode}</span> {glName}
              </TableCell>
              <TableCell>
                <Link href={`/accounting/bank/${bank.id}?period=${lastMonth}`} className="underline underline-offset-4">
                  Reconcile
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function BankPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BankContent />
    </Suspense>
  );
}
