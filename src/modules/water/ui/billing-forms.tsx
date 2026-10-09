"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import {
  addRouteAction,
  addZoneAction,
  approveAdjustmentAction,
  approveReadingAction,
  assignReaderAction,
  closeAccountAction,
  closePeriodAction,
  enterEstimateAction,
  enterReadingAction,
  excludeAccountAction,
  openPeriodAction,
  postBillingAction,
  prepareAdjustmentAction,
  rejectAdjustmentAction,
  rejectReadingAction,
} from "../billing-actions";

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

function Field({ id, label, children, className }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

const get = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// ── Zones, routes, readers ──

export function ZoneForm() {
  const { pending, error, done, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-3" action={(fd) => run(() => addZoneAction({ code: get(fd, "zoneCode"), name: get(fd, "zoneName") }), { success: "Zone added." })}>
      <Field id="zoneCode" label="Zone code">
        <Input id="zoneCode" name="zoneCode" maxLength={20} required className="w-32" />
      </Field>
      <Field id="zoneName" label="Zone name">
        <Input id="zoneName" name="zoneName" maxLength={100} required className="w-56" placeholder="e.g. Purok 3" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Add zone
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function RouteForm({ zones }: { zones: Array<{ id: number; code: string; name: string }> }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => run(() => addRouteAction({ zoneId: Number(get(fd, "routeZone")), code: get(fd, "routeCode"), name: get(fd, "routeName") }), { success: "Route added." })}
    >
      <Field id="routeZone" label="Zone of the new route">
        <select id="routeZone" name="routeZone" className={`${selectClass} w-56`} defaultValue={zones[0]?.id ?? ""}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.code} · {z.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="routeCode" label="Route code">
        <Input id="routeCode" name="routeCode" maxLength={20} required className="w-32" />
      </Field>
      <Field id="routeName" label="Route name">
        <Input id="routeName" name="routeName" maxLength={100} required className="w-56" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || zones.length === 0}>
        Add route
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function ReaderSelect({ routeId, routeCode, readerId, readers }: { routeId: string; routeCode: string; readerId: string | null; readers: Array<{ id: string; name: string }> }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <select
        aria-label={`Meter reader for ${routeCode}`}
        value={readerId ?? ""}
        disabled={pending}
        onChange={(e) => run(() => assignReaderAction({ routeId, readerId: e.target.value || null }))}
        className={`${selectClass} w-52`}
      >
        <option value="">No reader assigned</option>
        {readers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

// ── Periods ──

export function OpenPeriodForm({ zones, defaults }: { zones: Array<{ id: number; code: string; name: string }>; defaults: { period: string; readingFrom: string; readingTo: string; billDate: string } }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-6 sm:items-end"
      action={(fd) =>
        run(
          () =>
            openPeriodAction({
              zoneId: Number(get(fd, "zone")),
              period: get(fd, "period"),
              readingFrom: get(fd, "readingFrom"),
              readingTo: get(fd, "readingTo"),
              billDate: get(fd, "billDate"),
            }),
          { success: "Period opened." },
        )
      }
    >
      <Field id="zone" label="Zone">
        <select id="zone" name="zone" className={selectClass} defaultValue={zones[0]?.id ?? ""}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.code} · {z.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="period" label="Period (YYYY-MM)">
        <Input id="period" name="period" defaultValue={defaults.period} pattern="\d{4}-\d{2}" required />
      </Field>
      <Field id="readingFrom" label="Reading from">
        <Input id="readingFrom" name="readingFrom" type="date" defaultValue={defaults.readingFrom} required />
      </Field>
      <Field id="readingTo" label="Reading to">
        <Input id="readingTo" name="readingTo" type="date" defaultValue={defaults.readingTo} required />
      </Field>
      <Field id="billDate" label="Bill date">
        <Input id="billDate" name="billDate" type="date" defaultValue={defaults.billDate} required />
      </Field>
      <Button type="submit" disabled={pending || zones.length === 0}>
        Open period
      </Button>
      <div className="sm:col-span-6">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function ClosePeriodButton({ periodId }: { periodId: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => closePeriodAction({ periodId }))}>
        Close period
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

// ── Reading grid ──

export type GridRowView = {
  accountId: string;
  accountNo: string;
  sequenceNo: number;
  customerName: string;
  meterSerial: string;
  previous: number;
  average: number | null;
  note: string | null;
  excluded: string | null;
  reading: { id: string; presentReading: number | null; consumption: number; type: string; flags: string[]; status: string; rollover: boolean } | null;
};

/** Moves focus to the next present-reading input in the grid (Enter = save and go to the next account). */
function focusNext(from: HTMLElement) {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-reading-input]"));
  const i = inputs.indexOf(from as HTMLInputElement);
  inputs[i + 1]?.focus();
  inputs[i + 1]?.select();
}

export function ReadingRow({ periodId, row, canEnter, canReview, open }: { periodId: string; row: GridRowView; canEnter: boolean; canReview: boolean; open: boolean }) {
  const { pending, error, run } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [rollover, setRollover] = useState(row.reading?.rollover ?? false);
  const r = row.reading;
  const editable = open && canEnter && !row.excluded;

  function save(next: boolean) {
    const value = input.current?.value.trim() ?? "";
    if (value === "") return;
    run(() => enterReadingAction({ periodId, accountId: row.accountId, presentReading: Number(value), rollover, remarks: null }), {
      onSuccess: () => {
        if (next && input.current) focusNext(input.current);
      },
    });
  }

  return (
    <tr className="border-b align-top">
      <td className="px-2 py-1.5 tabular-nums">{row.sequenceNo}</td>
      <td className="px-2 py-1.5 font-mono text-xs">{row.accountNo}</td>
      <td className="px-2 py-1.5">
        {row.customerName}
        {row.note ? <div className="text-xs text-muted-foreground">{row.note}</div> : null}
      </td>
      <td className="px-2 py-1.5 font-mono text-xs">{row.meterSerial}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.previous.toLocaleString("en-US")}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.average ?? "—"}</td>
      <td className="px-2 py-1.5">
        {editable ? (
          <span className="flex items-center gap-2">
            <Input
              ref={input}
              data-reading-input
              aria-label={`Present reading for ${row.accountNo}`}
              defaultValue={r?.presentReading ?? ""}
              inputMode="numeric"
              className="w-24"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save(true);
                }
              }}
            />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" aria-label={`Rollover for ${row.accountNo}`} checked={rollover} onChange={(e) => setRollover(e.target.checked)} />R
            </label>
            <Button type="button" size="sm" variant="outline" aria-label={`Save reading for ${row.accountNo}`} disabled={pending} onClick={() => save(false)}>
              Save
            </Button>
          </span>
        ) : (
          <span className="tabular-nums">{r ? (r.presentReading === null ? "estimated" : r.presentReading.toLocaleString("en-US")) : "—"}</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r ? `${r.consumption} m³` : ""}</td>
      <td className="px-2 py-1.5 text-xs">
        {row.excluded ? (
          <span>EXCLUDED: {row.excluded}</span>
        ) : r ? (
          <span>
            <span className={r.status === "APPROVED" ? "text-green-700 dark:text-green-400" : r.status === "REJECTED" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>{r.status}</span>
            {r.type !== "ACTUAL" ? ` · ${r.type}` : ""}
            {r.flags.length ? ` · ${r.flags.join(", ")}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">not read</span>
        )}
        <Err error={error} />
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {open && canReview && r?.status === "ENTERED" ? (
          <>
            <Button type="button" size="sm" aria-label={`Approve reading for ${row.accountNo}`} disabled={pending} onClick={() => run(() => approveReadingAction({ readingId: r.id }))}>
              Approve
            </Button>{" "}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Reject reading for ${row.accountNo}`}
              disabled={pending}
              onClick={() => {
                const reason = window.prompt(`Why reject the reading for ${row.accountNo}?`);
                if (reason) run(() => rejectReadingAction({ readingId: r.id, reason }));
              }}
            >
              Reject
            </Button>
          </>
        ) : null}
        {open && canReview && !row.excluded && (!r || r.status !== "APPROVED") ? (
          <>
            {" "}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Estimate ${row.accountNo}`}
              disabled={pending}
              onClick={() => {
                const m3 = window.prompt(`Estimated m³ for ${row.accountNo}${row.average === null ? "" : ` (3-month average: ${row.average} m³)`}`);
                if (m3 === null || !/^\d+$/.test(m3.trim())) return;
                const reason = window.prompt(`Why couldn't ${row.accountNo} be read?`);
                if (reason) run(() => enterEstimateAction({ periodId, accountId: row.accountId, reason, consumption: Number(m3.trim()) }));
              }}
            >
              Estimate
            </Button>
            {!r ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Exclude ${row.accountNo}`}
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt(`Why leave ${row.accountNo} out of this billing run?`);
                  if (reason) run(() => excludeAccountAction({ periodId, accountId: row.accountId, reason }));
                }}
              >
                Exclude
              </Button>
            ) : null}
          </>
        ) : null}
      </td>
    </tr>
  );
}

// ── Billing run ──

export function PostRunButton({ periodId, count }: { periodId: string; count: number }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          disabled={pending || count === 0}
          onClick={() => run(() => postBillingAction({ periodId }))}
        >
          Post billing run
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Posts {count} bill{count === 1 ? "" : "s"} and one journal entry. Posted bills can&apos;t be edited; corrections are credit/debit memos.
      </p>
      <Err error={error} />
    </div>
  );
}

// ── Memos ──

export function MemoForm({ billId }: { billId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(() => prepareAdjustmentAction({ billId, kind: get(fd, "memoKind") as "CREDIT" | "DEBIT", amount: get(fd, "memoAmount"), reason: get(fd, "memoReason") }), { success: "Memo prepared; it posts when a manager approves it." })
      }
    >
      <Field id="memoKind" label="Memo">
        <select id="memoKind" name="memoKind" className={`${selectClass} w-40`} defaultValue="CREDIT">
          <option value="CREDIT">Credit memo (less)</option>
          <option value="DEBIT">Debit memo (more)</option>
        </select>
      </Field>
      <Field id="memoAmount" label="Amount (₱)">
        <Input id="memoAmount" name="memoAmount" inputMode="decimal" required className="w-32" />
      </Field>
      <Field id="memoReason" label="Reason">
        <Input id="memoReason" name="memoReason" maxLength={300} required className="w-72" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Prepare memo
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function MemoDecision({ memoId, label }: { memoId: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" size="sm" aria-label={`Approve memo ${label}`} disabled={pending} onClick={() => run(() => approveAdjustmentAction({ adjustmentId: memoId }))}>
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Reject memo ${label}`}
        disabled={pending}
        onClick={() => {
          const reason = window.prompt("Why reject this memo?");
          if (reason) run(() => rejectAdjustmentAction({ adjustmentId: memoId, reason }));
        }}
      >
        Reject
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

// ── Closure ──

export function CloseAccountForm({ accountId, accountNo }: { accountId: string; accountNo: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => {
        if (!window.confirm(`Close ${accountNo}? Its final bill is posted now and the meter is removed.`)) return;
        run(() => closeAccountAction({ accountId, finalReading: Number(get(fd, "finalReading")), rollover: fd.get("finalRollover") === "on", reason: get(fd, "closeReason") }), {
          onSuccess: (d) => router.push(`/water/bills/${d.billId}`),
        });
      }}
    >
      <Field id="finalReading" label="Final reading">
        <Input id="finalReading" name="finalReading" inputMode="numeric" required className="w-32" />
      </Field>
      <label className="flex items-center gap-1 pb-2 text-sm">
        <input type="checkbox" name="finalRollover" /> Rollover
      </label>
      <Field id="closeReason" label="Reason for closing">
        <Input id="closeReason" name="closeReason" maxLength={300} required className="w-72" />
      </Field>
      <Button type="submit" variant="destructive" disabled={pending}>
        Close account and bill
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}
