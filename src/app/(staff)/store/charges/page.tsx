import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { getSetting } from "@/modules/settings/service";
import { memberCharges } from "@/modules/store/pos";
import { ChargeLimitByNoForm, ChargeLimitForm } from "@/modules/store/ui/charge-forms";

export const metadata: Metadata = { title: "Member charges · PCMPC MIS" };

const pesos = (m: bigint) => format(m).replace("₱", "");

async function ChargesContent() {
  const access = await guardPage("store.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [rows, defaultLimit] = await Promise.all([memberCharges(), getSetting("store.member_credit_limit")]);
  const canSet = can(access.user, "store.supervise");
  const total = rows.reduce((s, r) => s + r.balance, 0n);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Member charges</h1>
        <p className="text-sm text-muted-foreground">
          What members owe the store (Accounts Receivable – Members). A charge sale can&apos;t take a member past their credit limit ({format(BigInt(defaultLimit))} unless the manager sets their own). Members
          pay at the teller counter (Store charges payment).
        </p>
      </div>
      {canSet ? <ChargeLimitByNoForm /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="text-right">Owes</TableHead>
            <TableHead className="text-right">Credit limit</TableHead>
            <TableHead className="text-right">Can still charge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No member has a store account yet.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((r) => (
            <TableRow key={r.member.id}>
              <TableCell>
                <Link href={`/store/charges/${r.member.id}`} className="underline-offset-4 hover:underline">
                  {r.member.lastName}, {r.member.firstName}
                </Link>{" "}
                <span className="font-mono text-xs text-muted-foreground">{r.member.memberNo}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(r.balance)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {canSet ? <ChargeLimitForm memberId={r.member.id} limit={pesos(r.limit)} label={`${r.member.lastName}, ${r.member.firstName}`} /> : `${format(r.limit)}${r.own ? "" : " (default)"}`}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(r.available)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total owed</TableCell>
            <TableCell className="text-right tabular-nums">{format(total)}</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export default function ChargesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ChargesContent />
    </Suspense>
  );
}
