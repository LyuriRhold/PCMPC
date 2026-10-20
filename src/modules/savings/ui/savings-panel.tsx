import Decimal from "decimal.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import type { DepositTxnType } from "../schema";
import { depositLedger, listProducts, memberAccounts, memberTimeDeposits } from "../service";
import { CloseAccountButton, OpenAccountButton, PlaceTimeDepositForm, ReactivateForm, TimeDepositActions, WithdrawForm } from "./savings-forms";

export const DEPOSIT_TXN_LABEL: Record<DepositTxnType, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  INTEREST: "Interest",
  WTAX: "Withholding tax",
  ADJUSTMENT: "Correction",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  OPENING: "Opening balance",
};

export const pct = (rate: string) => new Decimal(rate).mul(100).toString();
const signed = (m: bigint) => (m < 0n ? `−${format(-m)}` : format(m));
const TD_STATUS: Record<string, string> = { ACTIVE: "Active", MATURED: "Matured", PRETERMINATED: "Pre-terminated", ROLLED_OVER: "Rolled over" };

/** The member profile's Savings tab: accounts with their passbooks, and time deposits. */
export async function SavingsPanel({
  memberId,
  memberStatus,
  can,
}: {
  memberId: string;
  memberStatus: string;
  /** post = open accounts and time deposits; cash = withdraw/close at the teller; approve = reactivate. */
  can: { post: boolean; cash: boolean; approve: boolean };
}) {
  const [accounts, tds, products] = await Promise.all([memberAccounts(memberId), memberTimeDeposits(memberId), listProducts()]);
  const ledgers = await Promise.all(accounts.map((a) => depositLedger(a.account.id)));
  const savingsProduct = products.find((p) => p.kind === "SAVINGS" && p.active);
  const tdProducts = products.filter((p) => p.kind === "TIME" && p.active);
  const savings = accounts.filter((a) => a.product.kind === "SAVINGS");
  const openSavings = savings.filter((a) => a.account.status === "OPEN");
  const hasRegular = savings.some((a) => a.account.status !== "CLOSED");
  const today = businessToday();

  return (
    <div className="flex flex-col gap-5">
      {can.post && memberStatus === "ACTIVE" && !hasRegular && savingsProduct ? (
        <OpenAccountButton memberId={memberId} productId={savingsProduct.id} productName={savingsProduct.name} />
      ) : null}
      {accounts.length === 0 ? <p className="text-sm text-muted-foreground">No savings or time-deposit accounts yet.</p> : null}

      {savings.map((a) => {
        const ledger = ledgers[accounts.indexOf(a)];
        return (
          <Card key={a.account.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                <span className="font-mono">{a.account.accountNo}</span>
                <span className="text-sm font-normal text-muted-foreground">{a.product.name}</span>
                <Badge variant={a.account.status === "OPEN" ? "default" : "outline"}>{a.account.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-2xl font-semibold tabular-nums" data-testid="savings-balance">
                    {format(a.balance)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pct(a.product.ratePa)}% a year · maintaining balance {format(a.product.maintainingBalance)} · opened {formatDate(a.account.openedAt)}
                  {a.account.lastCustomerTxnAt ? ` · last deposit/withdrawal ${formatDate(a.account.lastCustomerTxnAt)}` : ""}
                </p>
              </div>
              {a.account.status === "DORMANT" ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">Dormant: a deposit at the teller reactivates it; withdrawals need the manager to reactivate it first.</p>
              ) : null}
              <div className="flex flex-wrap items-start gap-6">
                {can.cash && a.account.status === "OPEN" ? <WithdrawForm accountId={a.account.id} accountNo={a.account.accountNo} /> : null}
                {can.cash && a.account.status === "OPEN" ? <CloseAccountButton accountId={a.account.id} accountNo={a.account.accountNo} balance={String(a.balance)} /> : null}
                {can.approve && a.account.status === "DORMANT" ? <ReactivateForm accountId={a.account.id} /> : null}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger && ledger.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No transactions yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {ledger?.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums">{formatDate(r.date)}</TableCell>
                      <TableCell>
                        {DEPOSIT_TXN_LABEL[r.type]}
                        {r.remarks ? <div className="text-xs text-muted-foreground">{r.remarks}</div> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.refNo ?? r.jeNo ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{signed(r.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{format(r.balanceAfter)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Time deposits</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {can.post && memberStatus === "ACTIVE" && openSavings.length > 0 && tdProducts.length > 0 ? (
            <PlaceTimeDepositForm
              memberId={memberId}
              products={tdProducts.map((p) => ({ id: p.id, name: p.name, ratePct: pct(p.ratePa) }))}
              accounts={openSavings.map((a) => ({ id: a.account.id, accountNo: a.account.accountNo, available: String(a.balance > a.product.maintainingBalance ? a.balance - a.product.maintainingBalance : 0n) }))}
            />
          ) : null}
          {tds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time deposits.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Certificate</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead>Rate · term</TableHead>
                  <TableHead>Placed → matures</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tds.map(({ td }) => (
                  <TableRow key={td.id}>
                    <TableCell className="font-mono text-xs">{td.certificateNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(td.principal)}</TableCell>
                    <TableCell>
                      {pct(td.ratePa)}% · {td.termDays} days
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(td.placementDate)} → {formatDate(td.maturityDate)}
                    </TableCell>
                    <TableCell>{TD_STATUS[td.status] ?? td.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{td.status === "ACTIVE" ? "" : format(td.interestPaid)}</TableCell>
                    <TableCell>{can.post && td.status === "ACTIVE" ? <TimeDepositActions timeDepositId={td.id} certificateNo={td.certificateNo} matured={today >= td.maturityDate} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
