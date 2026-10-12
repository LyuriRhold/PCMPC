"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import {
  closeAccountAction,
  matureTimeDepositAction,
  openAccountAction,
  placeTimeDepositAction,
  preterminateTimeDepositAction,
  reactivateAction,
  rolloverTimeDepositAction,
  runInterestAction,
  updateProductAction,
  withdrawAction,
} from "../actions";

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

export function OpenAccountButton({ memberId, productId, productName }: { memberId: string; productId: string; productName: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button type="button" disabled={pending} onClick={() => run(() => openAccountAction({ memberId, productId }), { success: `${productName} account opened.` })}>
          Open savings account
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Teller: cash withdrawal from the drawer (never below the maintaining balance). */
export function WithdrawForm({ accountId, accountNo }: { accountId: string; accountNo: string }) {
  const { pending, error, done, run } = useAction();
  const [amount, setAmount] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={() => {
        if (!window.confirm(`Pay out ₱${amount} from ${accountNo} in cash from your drawer?`)) return;
        run(() => withdrawAction({ accountId, amount }), { success: "Withdrawal paid out.", onSuccess: () => setAmount("") });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wd-${accountId}`}>Withdrawal amount</Label>
        <Input id={`wd-${accountId}`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="w-36" />
      </div>
      <Button type="submit" variant="outline" disabled={pending || !amount.trim()}>
        Withdraw
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Teller: closes the account and pays out the whole balance. */
export function CloseAccountButton({ accountId, accountNo, balance }: { accountId: string; accountNo: string; balance: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Close ${accountNo} and pay out its whole balance of ${format(BigInt(balance))} in cash?`)) return;
            run(() => closeAccountAction({ accountId }), { success: "Account closed." });
          }}
        >
          Close account
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Manager: reactivates a dormant account. */
export function ReactivateForm({ accountId }: { accountId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => reactivateAction({ accountId, reason: String(fd.get("reason") ?? "") }), { success: "Account reactivated." })}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`re-${accountId}`}>Reason for reactivating</Label>
        <Input id={`re-${accountId}`} name="reason" required maxLength={300} className="w-64" placeholder="e.g. Member came in with an ID" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Reactivate
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Places a time deposit funded from one of the member's savings accounts. */
export function PlaceTimeDepositForm({
  memberId,
  products,
  accounts,
}: {
  memberId: string;
  products: Array<{ id: string; name: string; ratePct: string }>;
  accounts: Array<{ id: string; accountNo: string; available: string }>;
}) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(
          () =>
            placeTimeDepositAction({
              memberId,
              productId: String(fd.get("tdProduct") ?? ""),
              fromAccountId: String(fd.get("tdFrom") ?? ""),
              principal: String(fd.get("tdPrincipal") ?? ""),
              termDays: Number(fd.get("tdTerm") ?? 0),
            }),
          { success: "Time deposit placed." },
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tdProduct">Product</Label>
        <select id="tdProduct" name="tdProduct" className={selectClass}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.ratePct}% a year)
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tdFrom">From savings account</Label>
        <select id="tdFrom" name="tdFrom" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNo} (up to {format(BigInt(a.available))})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tdPrincipal">Amount (₱)</Label>
        <Input id="tdPrincipal" name="tdPrincipal" inputMode="decimal" required className="w-36" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tdTerm">Term (days)</Label>
        <Input id="tdTerm" name="tdTerm" inputMode="numeric" required defaultValue="180" className="w-24" />
      </div>
      <Button type="submit" disabled={pending}>
        Place time deposit
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Ends a certificate: at maturity (or roll over), or before it (pre-terminate). */
export function TimeDepositActions({ timeDepositId, certificateNo, matured }: { timeDepositId: string; certificateNo: string; matured: boolean }) {
  const end = useAction();
  const roll = useAction();
  const [withInterest, setWithInterest] = useState(true);
  const [term, setTerm] = useState("180");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {matured ? (
          <Button type="button" size="sm" disabled={end.pending} onClick={() => end.run(() => matureTimeDepositAction({ timeDepositId }), { success: "Matured: principal and interest moved to savings." })}>
            Mature to savings
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={end.pending}
            onClick={() => {
              if (!window.confirm(`Pre-terminate ${certificateNo}? It earns only the regular savings rate for the days held.`)) return;
              end.run(() => preterminateTimeDepositAction({ timeDepositId }), { success: "Pre-terminated: principal and interest moved to savings." });
            }}
          >
            Pre-terminate
          </Button>
        )}
        {matured ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`term-${timeDepositId}`} className="text-xs">
                New term (days)
              </Label>
              <Input id={`term-${timeDepositId}`} value={term} onChange={(e) => setTerm(e.target.value)} inputMode="numeric" className="h-8 w-20" />
            </div>
            <label className="flex items-center gap-1 pb-1.5 text-xs">
              <input type="checkbox" checked={withInterest} onChange={(e) => setWithInterest(e.target.checked)} /> with interest
            </label>
            <Button type="button" size="sm" variant="outline" disabled={roll.pending} onClick={() => roll.run(() => rolloverTimeDepositAction({ timeDepositId, withInterest, termDays: Number(term) }), { success: "Rolled over." })}>
              Roll over
            </Button>
          </>
        ) : null}
      </div>
      <Err error={end.error ?? roll.error} />
      <Done done={end.done ?? roll.done} />
    </div>
  );
}

/** Bookkeeper: posts the previewed quarter's interest. */
export function PostInterestButton({ productId, periodEnd, total }: { productId: string; periodEnd: string; total: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Post ${format(BigInt(total))} interest for the quarter ending ${periodEnd}? This can be done only once.`)) return;
            run(() => runInterestAction({ productId, periodEnd }), { success: "Interest posted." });
          }}
        >
          Post interest
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Admin: a deposit product's rates and limits. */
export function ProductForm({
  product,
}: {
  product: { id: string; kind: string; name: string; ratePct: string; minBalanceEarn: string; maintainingBalance: string; dormantAfterMonths: number | null; wtaxPct: string; active: boolean };
}) {
  const { pending, error, done, run } = useAction();
  const p = product;
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      action={(fd) =>
        run(
          () =>
            updateProductAction({
              productId: p.id,
              name: String(fd.get("name") ?? ""),
              ratePct: String(fd.get("ratePct") ?? ""),
              minBalanceEarn: String(fd.get("minBalanceEarn") ?? "0"),
              maintainingBalance: String(fd.get("maintainingBalance") ?? "0"),
              dormantAfterMonths: p.kind === "SAVINGS" ? Number(fd.get("dormantAfterMonths") ?? 0) : null,
              wtaxPct: String(fd.get("wtaxPct") ?? "0"),
              active: fd.get("active") === "on",
            }),
          { success: "Saved." },
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`name-${p.id}`}>Name</Label>
        <Input id={`name-${p.id}`} name="name" defaultValue={p.name} required maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`rate-${p.id}`}>Interest rate (% a year)</Label>
        <Input id={`rate-${p.id}`} name="ratePct" defaultValue={p.ratePct} inputMode="decimal" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wtax-${p.id}`}>Withholding tax on interest (%)</Label>
        <Input id={`wtax-${p.id}`} name="wtaxPct" defaultValue={p.wtaxPct} inputMode="decimal" required />
      </div>
      {p.kind === "SAVINGS" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`min-${p.id}`}>Minimum average balance to earn (₱)</Label>
            <Input id={`min-${p.id}`} name="minBalanceEarn" defaultValue={p.minBalanceEarn} inputMode="decimal" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`maint-${p.id}`}>Maintaining balance (₱)</Label>
            <Input id={`maint-${p.id}`} name="maintainingBalance" defaultValue={p.maintainingBalance} inputMode="decimal" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`dorm-${p.id}`}>Dormant after (months without deposits or withdrawals)</Label>
            <Input id={`dorm-${p.id}`} name="dormantAfterMonths" defaultValue={String(p.dormantAfterMonths ?? 24)} inputMode="numeric" required />
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="minBalanceEarn" value="0" />
          <input type="hidden" name="maintainingBalance" value="0" />
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={p.active} /> Offered to members
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
