"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format } from "@/lib/money";
import { memberByNoAction, subscribeAction, transferAction, withdrawSharesAction } from "../actions";

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

/** Teller: pays out a terminating member's share capital from the open session. */
export function WithdrawForm({ memberId, paidUp }: { memberId: string; paidUp: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => {
        if (!window.confirm(`Pay out ${format(BigInt(paidUp))} share capital in cash and cancel the unpaid subscription? Do this only for a member being terminated.`)) return;
        run(() => withdrawSharesAction({ memberId, reason: String(fd.get("withdrawReason") ?? "") }), { success: "Share capital paid out." });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="withdrawReason">Reason (termination)</Label>
        <Input id="withdrawReason" name="withdrawReason" required maxLength={300} className="w-72" placeholder="e.g. Resignation, Board res. 2026-30" />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        Pay out share capital
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

