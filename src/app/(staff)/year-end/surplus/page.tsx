import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { can } from "@/lib/auth-guard";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { fractionToPercent } from "@/lib/rates";
import { fiscalYears } from "@/modules/ledger/schema";
import { getSetting } from "@/modules/settings/service";
import { ratePercent } from "@/modules/surplus/engine";
import { cetfReport, listAllocations } from "@/modules/surplus/service";
import { DraftForm } from "@/modules/surplus/ui/forms";

export const metadata: Metadata = { title: "Net surplus allocation · PCMPC MIS" };

const STATUS: Record<string, string> = { DRAFT: "Draft", APPROVED: "Approved", POSTED: "Posted", DISTRIBUTED: "Distributed" };

async function SurplusContent() {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [reserve, etf, cdf, optional, iscShare, prShare, basis, wtax, offset, payout] = [
    await getSetting("surplus.reserve_pct"),
    await getSetting("surplus.etf_pct"),
    await getSetting("surplus.cdf_pct"),
    await getSetting("surplus.optional_pct"),
    await getSetting("surplus.isc_share_of_remaining"),
    await getSetting("surplus.pr_share_of_remaining"),
    await getSetting("surplus.pr_basis"),
    await getSetting("surplus.isc_pr_wtax_rate"),
    await getSetting("surplus.offset_arrears_first"),
    await getSetting("surplus.default_payout"),
  ];
  const [allocations, cetf, closed] = [await listAllocations(), await cetfReport(), await getDb().select({ year: fiscalYears.year }).from(fiscalYears).where(eq(fiscalYears.status, "CLOSED")).orderBy(desc(fiscalYears.year))];
  const draftable = closed.map((c) => c.year).filter((y) => !allocations.some((a) => a.fiscalYear === y && a.status !== "DRAFT"));
  const counts = [basis.loanInterestPaid ? "loan interest paid" : null, basis.netStorePurchases ? "store purchases" : null, basis.waterBillsPaidByMembers ? "water bills paid" : null].filter(Boolean).join(", ") || "nothing";
  const payoutText = [
    ["to savings", payout.savings],
    ["to share capital", payout.capitalize],
    ["in cash", payout.cash],
  ]
    .filter(([, f]) => f !== "0")
    .map(([what, f]) => `${fractionToPercent(f ?? "0")}% ${what}`)
    .join(", ");
  const policy: Array<[string, string]> = [
    ["Reserve fund", `${ratePercent(reserve)} of net surplus`],
    ["Education and training fund", `${ratePercent(etf)} of net surplus (half to the CETF)`],
    ["Community development fund", `${ratePercent(cdf)} of net surplus`],
    ["Optional fund", `${ratePercent(optional)} of net surplus`],
    ["Interest on share capital", `${ratePercent(iscShare)} of what remains, by average share month`],
    ["Patronage refund", `${ratePercent(prShare)} of what remains, by patronage (${counts})`],
    ["Withholding tax on ISC and PR", ratePercent(wtax)],
    ["Past-due loan amounts", offset ? "deducted first" : "not deducted"],
    ["Paid out unless the member chooses", payoutText],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Net surplus allocation</h1>
        <p className="text-sm text-muted-foreground">
          After the year-end close, the year&apos;s net surplus goes to the statutory funds (RA 9520), then what remains is shared as interest on share capital and patronage refund. The bookkeeper
          prepares it, the manager approves it, and it is posted once the General Assembly approves it; then each member is paid by their choice.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Percentages in force</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {policy.map(([label, value]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  <TableCell>{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            They are coop settings; the allocation can use other percentages if the General Assembly approved them.{" "}
            {can(access.user, "admin.settings") ? (
              <Link href="/admin/settings" className="underline underline-offset-4">
                Open settings
              </Link>
            ) : null}
          </p>
        </CardContent>
      </Card>
      {can(access.user, "surplus.prepare") ? (
        <Card>
          <CardHeader>
            <CardTitle>Draft an allocation</CardTitle>
          </CardHeader>
          <CardContent>
            {draftable.length ? (
              <DraftForm
                years={draftable}
                defaults={{
                  reserve: fractionToPercent(reserve),
                  etf: fractionToPercent(etf),
                  cdf: fractionToPercent(cdf),
                  optional: fractionToPercent(optional),
                  iscShare: fractionToPercent(iscShare),
                  prShare: fractionToPercent(prShare),
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No closed fiscal year is waiting for its allocation. Close the year first on{" "}
                <Link href="/accounting/close" className="underline underline-offset-4">
                  Period close
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fiscal year</TableHead>
            <TableHead className="text-right">Net surplus</TableHead>
            <TableHead className="text-right">Interest on share capital</TableHead>
            <TableHead className="text-right">Patronage refund</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allocations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No allocations yet.
              </TableCell>
            </TableRow>
          ) : null}
          {allocations.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link href={`/year-end/surplus/${a.id}`} className="underline underline-offset-4">
                  {a.fiscalYear}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(a.netSurplus)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.iscPool)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.prPool)}</TableCell>
              <TableCell>
                <Badge variant="outline">{STATUS[a.status]}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">CETF to remit</h2>
        <p className="text-sm text-muted-foreground">Half of each year&apos;s education and training fund is owed to the federation or union (CETF); it is remitted by disbursement voucher.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fiscal year</TableHead>
              <TableHead className="text-right">CETF</TableHead>
              <TableHead className="text-right">Remitted</TableHead>
              <TableHead className="text-right">On a DV not yet released</TableHead>
              <TableHead className="text-right">Left to remit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cetf.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No posted allocation yet.
                </TableCell>
              </TableRow>
            ) : null}
            {cetf.map((c) => (
              <TableRow key={c.allocationId}>
                <TableCell>
                  <Link href={`/year-end/surplus/${c.allocationId}`} className="underline underline-offset-4">
                    {c.fiscalYear}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{format(c.cetf)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(c.remitted)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(c.pending)}</TableCell>
                <TableCell className="text-right tabular-nums">{format(c.toRemit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function SurplusPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SurplusContent />
    </Suspense>
  );
}
