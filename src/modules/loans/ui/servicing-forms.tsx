"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import { authorizeReleaseAction, cancelReleaseAction, payFromSavingsAction, payOutProceedsAction, reauthorizeReleaseAction, restructureAction, writeOffAction } from "../servicing-actions";

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

type Account = { id: string; accountNo: string };

/** Manager (not the approver): authorizes the release with the first due date and how the proceeds are given. */
export function AuthorizeReleaseForm({ applicationId, defaultFirstDue, savingsAccounts }: { applicationId: string; defaultFirstDue: string; savingsAccounts: Account[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [firstDue, setFirstDue] = useState(defaultFirstDue);
  const [mode, setMode] = useState<"CASH" | "SAVINGS">("CASH");
  const [account, setAccount] = useState(savingsAccounts[0]?.id ?? "");
  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await authorizeReleaseAction({ applicationId, firstDueDate: firstDue, disbursement: mode, savingsAccountId: mode === "SAVINGS" ? account || null : null });
      if (!r.ok) return setError(r.error);
      router.push(`/loans/${r.data.loanId}`);
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstDue">First due date</Label>
          <Input id="firstDue" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="disbursement">Proceeds</Label>
          <select id="disbursement" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "CASH" | "SAVINGS")}>
            <option value="CASH">Cash, paid out by the teller</option>
            <option value="SAVINGS" disabled={savingsAccounts.length === 0}>
              Credited to the member&apos;s savings
            </option>
          </select>
        </div>
        {mode === "SAVINGS" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="savingsAccount">Savings account</Label>
            <select id="savingsAccount" className={selectClass} value={account} onChange={(e) => setAccount(e.target.value)}>
              {savingsAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountNo}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button type="button" disabled={pending} onClick={submit}>
          Authorize release
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Teller: pays the net proceeds out of the drawer. */
export function PayOutButton({ loanId, loanNo, net }: { loanId: string; loanNo: string; net: string }) {
  const { pending, error, done, run } = useAction();
  const amount = format(BigInt(net));
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Pay out ${amount} for loan ${loanNo} from your drawer?`)) return;
            run(() => payOutProceedsAction({ loanId }), { success: "Proceeds paid out; the loan is released." });
          }}
        >
          Pay out {amount}
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Manager (not the approver): authorizes a loan waiting for its payout again with a new first due date, or cancels it. */
export function PendingReleaseForms({ loanId, defaultFirstDue }: { loanId: string; defaultFirstDue: string }) {
  const again = useAction();
  const cancel = useAction();
  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-wrap items-end gap-2" action={(fd) => again.run(() => reauthorizeReleaseAction({ loanId, firstDueDate: String(fd.get("raFirst") ?? "") }), { success: "Authorized again; the teller can pay it out." })}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="raFirst">New first due date</Label>
          <Input id="raFirst" name="raFirst" type="date" defaultValue={defaultFirstDue} />
        </div>
        <Button type="submit" variant="outline" disabled={again.pending}>
          Authorize again
        </Button>
        <div className="w-full">
          <Err error={again.error} />
          <Done done={again.done} />
        </div>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        action={(fd) => {
          if (!window.confirm("Cancel this loan? Its application is cancelled too.")) return;
          cancel.run(() => cancelReleaseAction({ loanId, reason: String(fd.get("crReason") ?? "") }), { success: "Cancelled." });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crReason">Reason for cancelling</Label>
          <Input id="crReason" name="crReason" maxLength={300} className="w-64" />
        </div>
        <Button type="submit" variant="destructive" disabled={cancel.pending}>
          Cancel the loan
        </Button>
        <div className="w-full">
          <Err error={cancel.error} />
          <Done done={cancel.done} />
        </div>
      </form>
    </div>
  );
}

/** Manager: writes off the outstanding principal on the Board's resolution. */
export function WriteOffForm({ loanId }: { loanId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => writeOffAction({ loanId, bodRef: String(fd.get("woRef") ?? ""), reason: String(fd.get("woReason") ?? "") }), { success: "Written off." })}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="woRef">Board resolution no.</Label>
        <Input id="woRef" name="woRef" maxLength={100} className="w-44" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="woReason">Reason</Label>
        <Input id="woReason" name="woReason" maxLength={300} className="w-64" />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        Write off
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Manager: restructures the loan into a new one on the Board's resolution. */
export function RestructureForm({ loanId, defaultFirstDue }: { loanId: string; defaultFirstDue: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const r = await restructureAction({ loanId, term: Number(fd.get("rsTerm") ?? 0), firstDueDate: String(fd.get("rsFirst") ?? ""), bodRef: String(fd.get("rsRef") ?? ""), reason: String(fd.get("rsReason") ?? "") });
          if (!r.ok) return setError(r.error);
          router.push(`/loans/${r.data.loanId}`);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rsTerm">New term (months)</Label>
        <Input id="rsTerm" name="rsTerm" inputMode="numeric" className="w-28" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rsFirst">First due date</Label>
        <Input id="rsFirst" name="rsFirst" type="date" defaultValue={defaultFirstDue} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rsRef">Board resolution no.</Label>
        <Input id="rsRef" name="rsRef" maxLength={100} className="w-44" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rsReason">Reason</Label>
        <Input id="rsReason" name="rsReason" maxLength={300} className="w-64" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Restructure
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Teller: pays the loan from the member's savings (no cash). */
export function PayFromSavingsForm({ loanId, accounts }: { loanId: string; accounts: Account[] }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(fd) => run(() => payFromSavingsAction({ loanId, accountId: String(fd.get("psAccount") ?? ""), amount: String(fd.get("psAmount") ?? "") }), { success: "Paid from savings." })}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="psAccount">From savings</Label>
        <select id="psAccount" name="psAccount" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNo}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="psAmount">Amount (₱)</Label>
        <Input id="psAmount" name="psAmount" inputMode="decimal" className="w-32" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Pay from savings
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
