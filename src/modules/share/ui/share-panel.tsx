import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, isBusinessDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { getSetting } from "@/modules/settings/service";
import { TXN_LABEL } from "../labels";
import { averageShareMonth, isGoodStanding, membershipFeePaid, memberShareLedger, memberSubscriptions, pendingWithdrawal, shareBalance } from "../service";
import { ApproveWithdrawalForm, PendingWithdrawal, SubscribeForm, TransferForm } from "./share-forms";

const signed = (m: bigint) => (m === 0n ? "" : m < 0n ? `−${format(-m)}` : format(m));

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

/** The member profile's Share capital tab. */
export async function SharePanel({
  memberId,
  memberStatus,
  year,
  from,
  to,
  can,
}: {
  memberId: string;
  memberStatus: string;
  year: number;
  from: string | null;
  to: string | null;
  /** approve = transfers and withdrawal approvals (manager); payOut = paying out an approved withdrawal (teller). */
  can: { subscribe: boolean; approve: boolean; payOut: boolean };
}) {
  const range = { from: from && isBusinessDate(from) ? from : undefined, to: to && isBusinessDate(to) ? to : undefined };
  const [balance, fee, standing, asm, ledger, subs, par, minShares, approval] = await Promise.all([
    shareBalance(memberId),
    membershipFeePaid(memberId),
    isGoodStanding(memberId),
    averageShareMonth(memberId, year),
    memberShareLedger(memberId, range),
    memberSubscriptions(memberId),
    getSetting("share.par_value"),
    getSetting("share.min_subscription_shares"),
    pendingWithdrawal(memberId),
  ]);
  const open = memberStatus === "ACTIVE" || memberStatus === "INACTIVE";
  const exportQuery = new URLSearchParams({ member: memberId, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Subscribed" value={format(balance.subscribed)} testId="share-subscribed" />
        <Stat label="Paid-up" value={format(balance.paidUp)} testId="share-paid-up" />
        <Stat label="Unpaid subscription" value={format(balance.unpaid)} testId="share-unpaid" />
        <Stat label={`Average share month ${year}`} value={format(asm)} testId="share-asm" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={fee ? "default" : "outline"}>{fee ? "Membership fee paid" : "Membership fee not paid"}</Badge>
        <Badge variant={standing ? "default" : "outline"}>{standing ? "In good standing" : "Not yet in good standing"}</Badge>
        <span className="text-xs text-muted-foreground">Payments and the membership fee are collected at the teller counter.</span>
      </div>

      {open && (can.subscribe || can.approve || can.payOut) ? (
        <Card>
          <CardHeader>
            <CardTitle>Subscribe, transfer or withdraw</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {approval ? (
              <PendingWithdrawal
                memberId={memberId}
                paidUp={String(balance.paidUp)}
                approval={{ reason: approval.reason, bodRef: approval.bodRef, approvedBy: approval.approvedByName, approvedOn: formatDateTime(approval.approvedAt) }}
                canPay={can.payOut}
                canCancel={can.approve}
              />
            ) : null}
            {can.subscribe && !approval ? <SubscribeForm memberId={memberId} parValue={par} minShares={minShares} hasSubscription={balance.subscribed > 0n} /> : null}
            {can.approve && !approval && balance.paidUp > 0n && memberStatus === "ACTIVE" ? <TransferForm memberId={memberId} /> : null}
            {can.approve && !approval && balance.subscribed > 0n ? <ApproveWithdrawalForm memberId={memberId} /> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Par value</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No subscriptions yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {subs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="tabular-nums">{formatDate(s.subDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.shares.toLocaleString("en-US")}
                    {s.status === "CANCELLED" ? <span className="ml-1 text-xs text-muted-foreground">(withdrawn)</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(s.parValue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(s.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Member share ledger</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="share" />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={range.from ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={range.to ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="year">ASM year</Label>
              <Input id="year" name="year" inputMode="numeric" defaultValue={String(year)} className="w-24" />
            </div>
            <Button type="submit" size="sm">
              Show
            </Button>
            <a href={`/api/share/ledger?${exportQuery.toString()}`} className="text-sm underline underline-offset-4">
              Download Excel
            </a>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Subscribed</TableHead>
                <TableHead className="text-right">Paid-up</TableHead>
                <TableHead className="text-right">Paid-up balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {range.from ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    Balance before {formatDate(range.from)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(ledger.opening.paidUp)}</TableCell>
                </TableRow>
              ) : null}
              {ledger.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No share transactions.
                  </TableCell>
                </TableRow>
              ) : null}
              {ledger.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{formatDate(r.date)}</TableCell>
                  <TableCell>
                    {TXN_LABEL[r.type]}
                    {r.remarks ? <div className="text-xs text-muted-foreground">{r.remarks}</div> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.refNo ?? r.jeNo ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(r.subscribed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{signed(r.paidUp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.paidUpBalance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
