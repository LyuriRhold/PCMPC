"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format, parse } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import {
  closeMonthAction,
  createBankAccountAction,
  mapAccountAction,
  registerAssetAction,
  reopenMonthAction,
  runDepreciationAction,
  runMissedJobsAction,
  saveReconAction,
  setSegmentAction,
  voidAssetAction,
  yearEndCloseAction,
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

type Option = { id: string; label: string };

/** Bookkeeper: puts an account on a statement line. */
export function MapAccountForm({ accountId, label, lines, current }: { accountId: string; label: string; lines: Option[]; current: string | null }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-center gap-2" action={(fd) => run(() => mapAccountAction({ accountId, fsLineId: String(fd.get("fsLineId") ?? "") }))}>
      <select name="fsLineId" aria-label={`Statement line of ${label}`} className={`${selectClass} w-72`} defaultValue={current ?? ""}>
        <option value="">Choose a line…</option>
        {lines.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Bookkeeper: the business segment of a revenue or expense account. */
export function SegmentForm({ accountId, label, segments, current }: { accountId: string; label: string; segments: Option[]; current: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex items-center gap-2" action={(fd) => run(() => setSegmentAction({ accountId, segmentCode: String(fd.get("segment") ?? "") }))}>
      <select name="segment" aria-label={`Segment of ${label}`} className={`${selectClass} w-48`} defaultValue={current}>
        {segments.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Set
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Bookkeeper: closes a month (its checklist must pass). */
export function CloseMonthButton({ year, month, label }: { year: number; month: number; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Close ${label}? Nothing dated in it can be posted afterwards.`)) return;
            run(() => closeMonthAction({ year, month }));
          }}
        >
          Close {label}
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Bookkeeper: runs the daily jobs the month missed, so its checklist can pass. */
export function RunMissedJobsButton({ year, month, label }: { year: number; month: number; label: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Run the daily jobs ${label} missed? Each runs for its own date, oldest first.`)) return;
            run(() => runMissedJobsAction({ year, month }), { success: "The missed daily jobs ran." });
          }}
        >
          Run the missed daily jobs
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Administrator: reopens a closed month with a reason. */
export function ReopenMonthForm({ year, month }: { year: number; month: number }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-center gap-2" action={(fd) => run(() => reopenMonthAction({ year, month, reason: String(fd.get("reopenReason") ?? "") }))}>
      <Input name="reopenReason" aria-label="Reason for reopening" placeholder="Reason for reopening" maxLength={300} className="w-64" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Reopen
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Bookkeeper: the year-end close. */
export function YearEndCloseButton({ year }: { year: number }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Close fiscal year ${year}? Revenues and expenses go into Undivided Net Surplus and the year is locked.`)) return;
            run(() => yearEndCloseAction({ year }), { success: `Fiscal year ${year} closed.` });
          }}
        >
          Close fiscal year {year}
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Bookkeeper: adds an asset to the register. */
export function AssetForm({ classes }: { classes: Array<{ code: string; name: string; life: number }> }) {
  const { pending, error, done, run } = useAction();
  const [cls, setCls] = useState(classes[0]?.code ?? "");
  const life = classes.find((c) => c.code === cls)?.life ?? 60;
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      action={(fd) =>
        run(
          () =>
            registerAssetAction({
              tag: String(fd.get("tag") ?? ""),
              description: String(fd.get("description") ?? ""),
              classCode: cls,
              acquisitionDate: String(fd.get("acquisitionDate") ?? ""),
              cost: String(fd.get("cost") ?? ""),
              salvage: String(fd.get("salvage") ?? "0"),
              lifeMonths: Number(String(fd.get("lifeMonths") ?? "").replace(/\D/g, "") || "0"),
              openingAccumulated: String(fd.get("openingAccumulated") ?? "0"),
              depreciatedThrough: String(fd.get("depreciatedThrough") ?? ""),
            }),
          { success: "Asset added." },
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tag">Asset tag</Label>
        <Input id="tag" name="tag" maxLength={30} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-3">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="classCode">Class</Label>
        <select id="classCode" className={selectClass} value={cls} onChange={(e) => setCls(e.target.value)}>
          {classes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acquisitionDate">Acquired on</Label>
        <Input id="acquisitionDate" name="acquisitionDate" type="date" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cost">Cost (₱)</Label>
        <Input id="cost" name="cost" inputMode="decimal" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="salvage">Salvage value (₱)</Label>
        <Input id="salvage" name="salvage" inputMode="decimal" defaultValue="0.00" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lifeMonths">Useful life (months)</Label>
        <Input id="lifeMonths" name="lifeMonths" inputMode="numeric" key={cls} defaultValue={String(life)} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="openingAccumulated">Accumulated depreciation brought forward (₱)</Label>
        <Input id="openingAccumulated" name="openingAccumulated" inputMode="decimal" defaultValue="0.00" />
        <p className="text-xs text-muted-foreground">For an asset already depreciated in the books before; leave 0.00 for a new one.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="depreciatedThrough">Brought forward through</Label>
        <Input id="depreciatedThrough" name="depreciatedThrough" type="month" />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Add to the register
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Bookkeeper: voids a wrongly registered asset (before any depreciation is posted for it). */
export function VoidAssetForm({ assetId, tag }: { assetId: string; tag: string }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      action={(fd) => {
        if (!window.confirm(`Void ${tag}? It leaves the register and its tag can be used again.`)) return;
        run(() => voidAssetAction({ assetId, reason: String(fd.get("voidReason") ?? "") }));
      }}
    >
      <Input name="voidReason" aria-label={`Why ${tag} is voided`} placeholder="Why it is voided" maxLength={300} className="h-8 w-48" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Void
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Bookkeeper: the month's depreciation run. */
export function DepreciationRunForm({ defaultPeriod }: { defaultPeriod: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(fd) => {
        const period = String(fd.get("period") ?? "");
        run(() => runDepreciationAction({ period }), { success: `Depreciation for ${period} posted.` });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="period">Month</Label>
        <Input id="period" name="period" type="month" defaultValue={defaultPeriod} />
      </div>
      <Button type="submit" disabled={pending}>
        Run depreciation
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Bookkeeper: a bank account on one of the cash GL accounts. */
export function BankAccountForm({ cashAccounts }: { cashAccounts: Option[] }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(() => createBankAccountAction({ name: String(fd.get("bankLabel") ?? ""), bankName: String(fd.get("bankName") ?? ""), accountNo: String(fd.get("accountNo") ?? ""), glAccountId: String(fd.get("glAccountId") ?? "") }))
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankLabel">Name</Label>
        <Input id="bankLabel" name="bankLabel" placeholder="e.g. LBP current account" maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankName">Bank</Label>
        <Input id="bankName" name="bankName" maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accountNo">Account no.</Label>
        <Input id="accountNo" name="accountNo" maxLength={40} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="glAccountId">GL account</Label>
        <select id="glAccountId" name="glAccountId" className={selectClass}>
          {cashAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        Add bank account
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

type OpenLine = { id: string; date: string; label: string; debit: string; credit: string };
type Item = { key: number; date: string; description: string; amount: string };

/** Bookkeeper: the month's reconciliation; it saves only when it balances. */
export function ReconForm({ bankAccountId, period, monthEnd, bookBalance, open }: { bankAccountId: string; period: string; monthEnd: string; bookBalance: string; open: OpenLine[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bank, setBank] = useState("");
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const amount = (t: string) => {
    try {
      return t.trim() ? parse(t) : 0n;
    } catch {
      return null;
    }
  };
  const outstanding = open.filter((l) => !cleared.has(l.id));
  const dit = outstanding.reduce((s, l) => s + BigInt(l.debit), 0n);
  const oc = outstanding.reduce((s, l) => s + BigInt(l.credit), 0n);
  const adj = items.reduce((s, i) => s + (amount(i.amount) ?? 0n), 0n);
  const bankAmt = amount(bank);
  const difference = bankAmt === null ? null : bankAmt + dit - oc - (BigInt(bookBalance) + adj);
  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveReconAction({ bankAccountId, period, bankBalance: bank, clearedLineIds: [...cleared], bankItems: items.map((i) => ({ date: i.date, description: i.description, amount: i.amount })) });
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankBalance">Ending balance on the bank statement (₱)</Label>
        <Input id="bankBalance" inputMode="decimal" className="w-48" value={bank} onChange={(e) => setBank(e.target.value)} />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Tick the book entries that appear on the statement</p>
        <table className="w-full text-sm">
          <tbody>
            {open.length === 0 ? (
              <tr>
                <td className="py-2 text-muted-foreground">No open book entries.</td>
              </tr>
            ) : null}
            {open.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="w-8 py-1">
                  <input
                    type="checkbox"
                    aria-label={`Cleared: ${l.label}`}
                    checked={cleared.has(l.id)}
                    onChange={(e) => {
                      const next = new Set(cleared);
                      if (e.target.checked) next.add(l.id);
                      else next.delete(l.id);
                      setCleared(next);
                    }}
                  />
                </td>
                <td className="py-1 tabular-nums">{l.date}</td>
                <td className="py-1">{l.label}</td>
                <td className="py-1 text-right tabular-nums">{l.debit !== "0" ? format(BigInt(l.debit)) : ""}</td>
                <td className="py-1 text-right tabular-nums">{l.credit !== "0" ? format(-BigInt(l.credit)) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Bank-only items (charges, interest) the book doesn&apos;t have yet</p>
        {items.map((i) => (
          <div key={i.key} className="flex flex-wrap gap-2">
            <Input type="date" aria-label="Date" className="w-40" value={i.date} onChange={(e) => setItems(items.map((x) => (x.key === i.key ? { ...x, date: e.target.value } : x)))} />
            <Input aria-label="What it is" placeholder="e.g. Service charge" className="w-64" value={i.description} onChange={(e) => setItems(items.map((x) => (x.key === i.key ? { ...x, description: e.target.value } : x)))} />
            <Input aria-label="Amount (− for a charge)" placeholder="-50.00" inputMode="decimal" className="w-32" value={i.amount} onChange={(e) => setItems(items.map((x) => (x.key === i.key ? { ...x, amount: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, { key: Math.max(0, ...items.map((x) => x.key)) + 1, date: monthEnd, description: "", amount: "" }])}>
            Add a bank-only item
          </Button>
        </div>
      </div>
      <dl className="grid max-w-md grid-cols-2 gap-1 text-sm">
        <dt>Book balance</dt>
        <dd className="text-right tabular-nums">{format(BigInt(bookBalance))}</dd>
        <dt>Deposits in transit</dt>
        <dd className="text-right tabular-nums">{format(dit)}</dd>
        <dt>Outstanding checks</dt>
        <dd className="text-right tabular-nums">{format(oc)}</dd>
        <dt>Bank-only items</dt>
        <dd className="text-right tabular-nums">{format(adj)}</dd>
        <dt className="font-semibold">Difference</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="recon-difference">
          {difference === null ? "—" : format(difference)}
        </dd>
      </dl>
      <div>
        <Button type="button" disabled={pending || difference !== 0n} onClick={save}>
          Save the reconciliation
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}
