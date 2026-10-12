"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format } from "@/lib/money";
import { approveWithdrawalAction, cancelWithdrawalAction, memberByNoAction, subscribeAction, transferAction, withdrawSharesAction } from "../actions";

function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function Done({ done }: { done: string | null }) {
  return done ? <p className="text-sm text-green-700 dark:text-green-400">{done}</p> : null;
}

/** Subscribe more shares; shows the amount at the current par value. */
export function SubscribeForm({ memberId, parValue, minShares, hasSubscription }: { memberId: string; parValue: string; minShares: number; hasSubscription: boolean }) {
  const { pending, error, done, run } = useAction();
  const [shares, setShares] = useState(hasSubscription ? "" : String(minShares));
  const n = /^\d+$/.test(shares) ? BigInt(shares) : null;
  return (
    <form className="flex flex-wrap items-end gap-3" action={() => run(() => subscribeAction({ memberId, shares: Number(shares) }), { success: "Subscription recorded." })}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="shares">Shares to subscribe</Label>
        <Input id="shares" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="numeric" required className="w-32" />
      </div>
      <p className="pb-2 text-sm text-muted-foreground">× {format(BigInt(parValue))} par = {n === null ? "—" : format(n * BigInt(parValue))}</p>
      <Button type="submit" disabled={pending || n === null || n <= 0n}>
        Subscribe
      </Button>
      <div className="w-full">
        {!hasSubscription ? <p className="text-xs text-muted-foreground">The first subscription must be at least {minShares} shares.</p> : null}
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Transfer paid-up capital to another member (needs the Board resolution). */
export function TransferForm({ memberId }: { memberId: string }) {
  const { pending, error, done, run } = useAction();
  const lookup = useAction();
  const [to, setTo] = useState<{ id: string; name: string; status: string } | null>(null);
  const [toNo, setToNo] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="toMemberNo">Transfer to member no.</Label>
          <Input id="toMemberNo" value={toNo} onChange={(e) => setToNo(e.target.value)} placeholder="M-000002" className="w-40" />
        </div>
        <Button type="button" variant="outline" disabled={lookup.pending} onClick={() => lookup.run(() => memberByNoAction({ memberNo: toNo }), { onSuccess: setTo })}>
          Find member
        </Button>
      </div>
      <Err error={lookup.error} />
      {to ? (
        <form
          className="flex flex-wrap items-end gap-3"
          action={(fd) => run(() => transferAction({ fromMemberId: memberId, toMemberId: to.id, amount: String(fd.get("transferAmount") ?? ""), bodRef: String(fd.get("bodRef") ?? "") }), { success: "Transfer posted." })}
        >
          <p className="w-full text-sm">
            To <span className="font-medium">{to.name}</span> ({to.status})
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transferAmount">Amount (₱)</Label>
            <Input id="transferAmount" name="transferAmount" inputMode="decimal" required className="w-36" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bodRef">Board resolution no.</Label>
            <Input id="bodRef" name="bodRef" required maxLength={100} className="w-48" />
          </div>
          <Button type="submit" disabled={pending}>
            Transfer
          </Button>
        </form>
      ) : null}
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Manager, step 1 of a withdrawal: approves paying out a terminating member's share capital. */
export function ApproveWithdrawalForm({ memberId }: { memberId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => run(() => approveWithdrawalAction({ memberId, reason: String(fd.get("withdrawReason") ?? ""), bodRef: String(fd.get("withdrawBodRef") ?? "") }), { success: "Withdrawal approved. A teller can now pay it out." })}
    >
      <p className="w-full text-sm text-muted-foreground">Withdrawal (only for a member being terminated): approve it here; a teller then pays it out from the drawer.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="withdrawReason">Reason (termination)</Label>
        <Input id="withdrawReason" name="withdrawReason" required maxLength={300} className="w-64" placeholder="e.g. Resignation" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="withdrawBodRef">Board resolution no. (termination)</Label>
        <Input id="withdrawBodRef" name="withdrawBodRef" required maxLength={100} className="w-48" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Approve withdrawal
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** An approved withdrawal waiting for the teller: the teller pays it out, the manager can cancel it. */
export function PendingWithdrawal({
  memberId,
  paidUp,
  approval,
  canPay,
  canCancel,
}: {
  memberId: string;
  paidUp: string;
  approval: { reason: string; bodRef: string; approvedBy: string; approvedOn: string };
  canPay: boolean;
  canCancel: boolean;
}) {
  const pay = useAction();
  const cancel = useAction();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/50 p-3" data-testid="share-withdrawal-approved">
      <p className="text-sm">
        <span className="font-medium">Withdrawal approved</span> by {approval.approvedBy} on {approval.approvedOn} · {approval.reason} · Board res. {approval.bodRef}. Paid-up to pay out: {format(BigInt(paidUp))} (less any
        obligations).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {canPay ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pay.pending}
            onClick={() => {
              if (!window.confirm(`Pay out ${format(BigInt(paidUp))} share capital in cash from your drawer and cancel the unpaid subscription?`)) return;
              pay.run(() => withdrawSharesAction({ memberId }), { success: "Share capital paid out." });
            }}
          >
            Pay out share capital
          </Button>
        ) : null}
        {canCancel ? (
          <form className="flex flex-wrap items-end gap-2" action={(fd) => cancel.run(() => cancelWithdrawalAction({ memberId, reason: String(fd.get("cancelReason") ?? "") }), { success: "Approval cancelled." })}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cancelReason">Reason for cancelling</Label>
              <Input id="cancelReason" name="cancelReason" required maxLength={300} className="w-56" />
            </div>
            <Button type="submit" variant="outline" disabled={cancel.pending}>
              Cancel approval
            </Button>
          </form>
        ) : null}
      </div>
      <Err error={pay.error ?? cancel.error} />
      <Done done={pay.done ?? cancel.done} />
    </div>
  );
}

