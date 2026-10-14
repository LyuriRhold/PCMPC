import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { businessToday, formatDate, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { subsidiaryLedger } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { PrintButton } from "@/modules/cashiering/ui/buttons";
import { chargeAvailable } from "@/modules/store/pos";

export const metadata: Metadata = { title: "Store statement of account · PCMPC MIS" };

async function StatementContent(props: PageProps<"/store/charges/[id]">) {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [m] = await getDb().select().from(members).where(eq(members.id, id));
  if (!m) notFound();
  const sp = await props.searchParams;
  const today = businessToday();
  const pick = (v: unknown, d: string) => (typeof v === "string" && isBusinessDate(v) ? v : d);
  const from = pick(sp.from, `${today.slice(0, 4)}-01-01`);
  const to = pick(sp.to, today);
  const [ledger, account] = await Promise.all([subsidiaryLedger("accounts_receivable_members", m.id, from, to), chargeAvailable(m.id)]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/store/charges" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Member charges
        </Link>
        <PrintButton />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Statement of account · store charges</h1>
        <p className="text-sm text-muted-foreground">
          {m.lastName}, {m.firstName} ({m.memberNo}) · {formatDate(from)} to {formatDate(to)}
        </p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" size="sm">
          Show
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Owes now</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="charge-balance">
            {format(account.balance)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Credit limit</p>
          <p className="text-lg font-semibold tabular-nums">
            {format(account.limit)}
            {account.own ? "" : " (default)"}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Can still charge</p>
          <p className="text-lg font-semibold tabular-nums">{format(account.available)}</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Particulars</TableHead>
            <TableHead className="text-right">Charged</TableHead>
            <TableHead className="text-right">Paid / credited</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={4}>Balance before {formatDate(from)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(ledger.opening)}</TableCell>
          </TableRow>
          {ledger.lines.map((l, i) => (
            <TableRow key={`${l.jeId}-${i}`}>
              <TableCell className="tabular-nums">{formatDate(l.date)}</TableCell>
              <TableCell className="max-w-md truncate">{l.particulars}</TableCell>
              <TableCell className="text-right tabular-nums">{l.debit ? format(l.debit) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{l.credit ? format(l.credit) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.running)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function StatementPage(props: PageProps<"/store/charges/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <StatementContent {...props} />
    </Suspense>
  );
}
