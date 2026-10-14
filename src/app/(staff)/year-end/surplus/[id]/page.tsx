import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { ratePercent } from "@/modules/surplus/engine";
import { allocationLines, cetfReport, getAllocation } from "@/modules/surplus/service";
import { ApproveButton, CetfRemitForm, DistributeButton, ElectionForm, PostForm, RedraftButton, ReturnToDraftForm } from "@/modules/surplus/ui/forms";

export const metadata: Metadata = { title: "Net surplus allocation · PCMPC MIS" };

const STATUS: Record<string, string> = { DRAFT: "Draft", APPROVED: "Approved: waiting for the General Assembly", POSTED: "Posted", DISTRIBUTED: "Distributed" };
/** Basis points as a percent ("5000" → "50"). */
const pct = (bps: number) => String(bps / 100);
const election = (l: { electSavings: number; electCapitalize: number; electCash: number }) =>
  [
    [l.electSavings, "savings"],
    [l.electCapitalize, "share capital"],
    [l.electCash, "cash"],
  ]
    .filter(([b]) => b !== 0)
    .map(([b, what]) => `${pct(Number(b))}% ${what}`)
    .join(", ");

async function AllocationContent(props: PageProps<"/year-end/surplus/[id]">) {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const a = await getAllocation(id);
  if (!a) notFound();
  const lines = await allocationLines(a.id);
  const cetf = (await cetfReport()).find((c) => c.allocationId === a.id) ?? null;
  const user = access.user;
  const prepare = can(user, "surplus.prepare");
  const distributed = a.status === "DISTRIBUTED";
  const summary: Array<[string, string, Money, boolean?]> = [
    ["Net surplus", "", a.netSurplus, true],
    ["Reserve fund", ratePercent(a.reservePct), a.reserve],
    ["Education and training fund (local)", `${ratePercent(a.etfPct)} ÷ 2`, a.etfLocal],
    ["CETF (to the federation/union)", `${ratePercent(a.etfPct)} ÷ 2`, a.cetf],
    ["Community development fund", ratePercent(a.cdfPct), a.cdf],
    ["Optional fund", ratePercent(a.optionalPct), a.optional],
    ["What remains", "", a.remaining, true],
    ["Interest on share capital", `${ratePercent(a.iscShare)} · ${ratePercent(a.iscRate)} of ASM`, a.iscPool],
    ["Patronage refund", `${ratePercent(a.prShare)} · ${ratePercent(a.prRate)} of patronage`, a.prPool],
  ];
  const total = (pick: (l: (typeof lines)[number]) => Money) => lines.reduce((s, l) => s + pick(l), 0n);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/year-end/surplus" className="underline underline-offset-4">
              Net surplus allocation
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Fiscal year {a.fiscalYear}</h1>
          <p className="text-sm text-muted-foreground">
            <Badge variant="outline">{STATUS[a.status]}</Badge>
            {a.gaResolutionNo ? ` · GA resolution ${a.gaResolutionNo}` : ""}
            {a.distributedAt ? ` · paid out ${formatDateTime(a.distributedAt)}` : ""}
          </p>
        </div>
        <a href={`/api/reports/surplus/${a.id}`} className="text-sm underline underline-offset-4">
          Excel (.xlsx): summary and per-member list for the GA
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Allocation</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.map(([label, rate, amount, bold]) => (
              <TableRow key={label} className={bold ? "font-semibold" : undefined}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{rate}</TableCell>
                <TableCell className="text-right tabular-nums">{format(amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Card>
          <CardHeader>
            <CardTitle>Next step</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {a.status === "DRAFT" ? (
              <>
                <p>The bookkeeper checks the figures and the members&apos; choices; the manager approves.</p>
                {prepare ? <RedraftButton year={a.fiscalYear} /> : null}
                {can(user, "surplus.approve") ? <ApproveButton allocationId={a.id} revision={a.revision} /> : null}
              </>
            ) : null}
            {a.status === "APPROVED" ? (
              <>
                <p>Once the General Assembly approves it, enter its resolution no. to post the allocation to the ledger.</p>
                {prepare ? <PostForm allocationId={a.id} /> : null}
                {can(user, "surplus.approve") ? <ReturnToDraftForm allocationId={a.id} /> : null}
              </>
            ) : null}
            {a.status === "POSTED" ? (
              <>
                <p>Each member&apos;s past-due loan amounts are deducted first (if set), then the rest goes to savings, share capital or cash, as they chose.</p>
                {prepare ? <DistributeButton allocationId={a.id} members={lines.length} /> : null}
              </>
            ) : null}
            {distributed ? <p>Paid out. Cash payouts are on disbursement vouchers: the manager approves them and a teller releases them.</p> : null}
            {cetf ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <p>
                  CETF: {format(cetf.cetf)}; remitted {format(cetf.remitted)}; on a DV not yet released {format(cetf.pending)}; left {format(cetf.toRemit)}.
                </p>
                {prepare && cetf.toRemit > 0n ? <CetfRemitForm allocationId={a.id} left={format(cetf.toRemit).replace("₱", "")} /> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <h2 className="text-lg font-semibold">Members ({lines.length})</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="text-right">ASM</TableHead>
            <TableHead className="text-right">ISC</TableHead>
            <TableHead className="text-right">Patronage</TableHead>
            <TableHead className="text-right">PR</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            {distributed ? (
              <>
                <TableHead className="text-right">Withheld</TableHead>
                <TableHead className="text-right">Arrears</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Paid</TableHead>
              </>
            ) : (
              <TableHead>Payout (% savings · share capital · cash)</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={distributed ? 10 : 7} className="text-center text-sm text-muted-foreground">
                No member shares this allocation.
              </TableCell>
            </TableRow>
          ) : null}
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <span className="font-mono text-xs">{l.memberNo}</span> {l.name}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(l.asm)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.isc)}</TableCell>
              <TableCell className="text-right tabular-nums" title={`Loan interest ${format(l.patronageLoanInterest)} · store ${format(l.patronageStore)} · water ${format(l.patronageWater)}`}>
                {format(l.patronageTotal)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(l.pr)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(l.gross)}</TableCell>
              {distributed ? (
                <>
                  <TableCell className="text-right tabular-nums">{format(l.wtax)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(l.arrearsOffset)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(l.net)}</TableCell>
                  <TableCell className="text-sm">
                    {[l.payoutSavings > 0n ? `${format(l.payoutSavings)} savings` : null, l.payoutCapitalize > 0n ? `${format(l.payoutCapitalize)} share capital` : null, l.payoutCash > 0n ? `${format(l.payoutCash)} cash` : null]
                      .filter(Boolean)
                      .join(" · ") || "Nothing (offset)"}
                  </TableCell>
                </>
              ) : (
                <TableCell>
                  {prepare ? (
                    <ElectionForm lineId={l.id} savings={pct(l.electSavings)} capitalize={pct(l.electCapitalize)} cash={pct(l.electCash)} label={`${l.memberNo} ${l.name}`} />
                  ) : (
                    <span className="text-sm">{election(l)}</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
        {lines.length ? (
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{format(total((l) => l.asm))}</TableCell>
              <TableCell className="text-right tabular-nums">{format(total((l) => l.isc))}</TableCell>
              <TableCell className="text-right tabular-nums">{format(total((l) => l.patronageTotal))}</TableCell>
              <TableCell className="text-right tabular-nums">{format(total((l) => l.pr))}</TableCell>
              <TableCell className="text-right tabular-nums">{format(total((l) => l.gross))}</TableCell>
              {distributed ? (
                <>
                  <TableCell className="text-right tabular-nums">{format(total((l) => l.wtax))}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(total((l) => l.arrearsOffset))}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(total((l) => l.net))}</TableCell>
                  <TableCell />
                </>
              ) : (
                <TableCell />
              )}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

export default function AllocationPage(props: PageProps<"/year-end/surplus/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AllocationContent {...props} />
    </Suspense>
  );
}
