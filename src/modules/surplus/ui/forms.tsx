"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { approveAllocationAction, distributeAllocationAction, draftAllocationAction, postAllocationAction, remitCetfAction, setElectionAction } from "../actions";

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

export type PercentDefaults = { reserve: string; etf: string; cdf: string; optional: string; iscShare: string; prShare: string };

const FIELDS: Array<{ key: keyof PercentDefaults; label: string }> = [
  { key: "reserve", label: "Reserve fund (% of net surplus)" },
  { key: "etf", label: "Education and training fund (%)" },
  { key: "cdf", label: "Community development fund (%)" },
  { key: "optional", label: "Optional fund (%)" },
  { key: "iscShare", label: "Interest on share capital (% of what remains)" },
  { key: "prShare", label: "Patronage refund (% of what remains)" },
];

/** Bookkeeper: drafts (or re-drafts) a closed year's allocation with the percentages the GA approved (the settings by default). */
export function DraftForm({ years, defaults }: { years: number[]; defaults: PercentDefaults }) {
  const { pending, error, run } = useAction();
  const router = useRouter();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      action={(fd) => {
        const year = Number(fd.get("year"));
        run(() => draftAllocationAction({ year, ...Object.fromEntries(FIELDS.map((f) => [f.key, String(fd.get(f.key) ?? "")])) }), { onSuccess: (d) => router.push(`/year-end/surplus/${d.id}`) });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="year">Fiscal year</Label>
        <select id="year" name="year" className={selectClass} defaultValue={String(years[0] ?? "")}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <Label htmlFor={f.key}>{f.label}</Label>
          <Input id={f.key} name={f.key} inputMode="decimal" defaultValue={defaults[f.key]} />
        </div>
      ))}
      <div className="flex items-end">
        <Button type="submit" disabled={pending || years.length === 0}>
          Draft the allocation
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Bookkeeper: recomputes a draft with the current settings (members' elections are kept). */
export function RedraftButton({ year }: { year: number }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => draftAllocationAction({ year }), { success: "Recomputed with the current settings and figures." })}>
          Recompute
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Manager: approves the draft. */
export function ApproveButton({ allocationId }: { allocationId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveAllocationAction({ allocationId }), { success: "Approved." })}>
          Approve
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Bookkeeper: posts the approved allocation with the GA resolution no. */
export function PostForm({ allocationId }: { allocationId: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => postAllocationAction({ allocationId, gaResolutionNo: String(fd.get("gaResolutionNo") ?? "") }))}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gaResolutionNo">GA resolution no.</Label>
        <Input id="gaResolutionNo" name="gaResolutionNo" maxLength={60} className="w-48" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Post to the ledger
      </Button>
      <div className="basis-full">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Bookkeeper: pays out the posted allocation. */
export function DistributeButton({ allocationId, members }: { allocationId: string; members: number }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Pay out ${members} member${members === 1 ? "" : "s"} now? Arrears are offset first; cash goes out by disbursement vouchers.`)) return;
            run(() => distributeAllocationAction({ allocationId }), { success: "Distributed. Cash payouts are on disbursement vouchers for approval." });
          }}
        >
          Distribute
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Bookkeeper: a member's payout election (percent to savings, share capital and cash). */
export function ElectionForm({ lineId, savings, capitalize, cash, label }: { lineId: string; savings: string; capitalize: string; cash: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      action={(fd) => run(() => setElectionAction({ lineId, savings: String(fd.get("savings") ?? "0"), capitalize: String(fd.get("capitalize") ?? "0"), cash: String(fd.get("cash") ?? "0") }))}
    >
      <Input name="savings" aria-label={`${label}: % to savings`} defaultValue={savings} className="h-7 w-14 text-right" inputMode="decimal" />
      <Input name="capitalize" aria-label={`${label}: % to share capital`} defaultValue={capitalize} className="h-7 w-14 text-right" inputMode="decimal" />
      <Input name="cash" aria-label={`${label}: % in cash`} defaultValue={cash} className="h-7 w-14 text-right" inputMode="decimal" />
      <Button type="submit" size="sm" variant="outline" className="h-7" disabled={pending}>
        Save
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Bookkeeper: a DV remitting the year's CETF to the federation/union. */
export function CetfRemitForm({ allocationId, left }: { allocationId: string; left: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      action={(fd) =>
        run(
          () =>
            remitCetfAction({
              allocationId,
              amount: String(fd.get("cetfAmount") ?? ""),
              payee: String(fd.get("payee") ?? ""),
              mode: fd.get("mode") === "CHECK" ? "CHECK" : "CASH",
              checkNo: String(fd.get("checkNo") ?? "") || null,
            }),
          { success: "Disbursement voucher prepared; the manager approves it." },
        )
      }
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="payee">Federation or union</Label>
        <Input id="payee" name="payee" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cetfAmount">Amount (₱)</Label>
        <Input id="cetfAmount" name="cetfAmount" inputMode="decimal" defaultValue={left} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mode">Paid by</Label>
        <select id="mode" name="mode" className={selectClass} defaultValue="CHECK">
          <option value="CHECK">Check</option>
          <option value="CASH">Cash</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="checkNo">Check no.</Label>
        <Input id="checkNo" name="checkNo" maxLength={40} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Prepare the DV
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
