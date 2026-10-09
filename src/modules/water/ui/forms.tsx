"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import {
  activateAccountAction,
  addMeterAction,
  addRateScheduleAction,
  addSeniorEligibilityAction,
  approveApplicationAction,
  createApplicationAction,
  createCustomerAction,
  findCustomerAction,
  findMemberAction,
  inspectApplicationAction,
  installMeterAction,
  moveAccountToRouteAction,
  rejectApplicationAction,
  reorderRouteAction,
  replaceMeterAction,
  setMeterStatusAction,
  transferAccountAction,
} from "../actions";

const CLASSES = ["RESIDENTIAL", "COMMERCIAL", "INSTITUTIONAL", "BULK"] as const;
type Class = (typeof CLASSES)[number];

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
const opt = (fd: FormData, k: string) => get(fd, k) || null;
const int = (fd: FormData, k: string) => (get(fd, k) === "" ? Number.NaN : Number(get(fd, k)));

// ── Customers ──

export function CustomerForm() {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [type, setType] = useState<"NON_MEMBER" | "MEMBER">("NON_MEMBER");
  const [member, setMember] = useState<{ id: string; name: string; status: string; address: string } | null>(null);
  const lookup = useAction();

  return (
    <form
      className="grid max-w-3xl gap-4 sm:grid-cols-2"
      action={(fd) =>
        run(
          () =>
            createCustomerAction({
              type,
              memberId: type === "MEMBER" ? (member?.id ?? null) : null,
              lastName: opt(fd, "lastName"),
              firstName: opt(fd, "firstName"),
              middleName: opt(fd, "middleName"),
              businessName: opt(fd, "businessName"),
              address: get(fd, "address"),
              mobile: opt(fd, "mobile"),
              email: opt(fd, "email"),
              validIdType: opt(fd, "validIdType"),
              validIdNo: opt(fd, "validIdNo"),
              privacyConsent: fd.get("privacyConsent") === "on",
              remarks: opt(fd, "remarks"),
            }),
          { onSuccess: (d) => router.push(`/water/customers/${d.id}`) },
        )
      }
    >
      <Field id="type" label="Customer type">
        <select id="type" value={type} onChange={(e) => setType(e.target.value as "NON_MEMBER" | "MEMBER")} className={selectClass}>
          <option value="NON_MEMBER">Non-member</option>
          <option value="MEMBER">Member of the cooperative</option>
        </select>
      </Field>

      {type === "MEMBER" ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="memberNo">Member no.</Label>
          <div className="flex gap-2">
            <Input id="memberNo" name="memberNo" placeholder="M-000001" className="max-w-48" />
            <Button
              type="button"
              variant="outline"
              disabled={lookup.pending}
              onClick={() => {
                const el = document.getElementById("memberNo") as HTMLInputElement | null;
                lookup.run(() => findMemberAction({ memberNo: el?.value ?? "" }), { onSuccess: setMember });
              }}
            >
              Find member
            </Button>
          </div>
          <Err error={lookup.error} />
          {member ? (
            <p className="text-sm">
              <span className="font-medium">{member.name}</span> · {member.status} · {member.address}
              <br />
              <span className="text-muted-foreground">Name, address and mobile are taken from the member record.</span>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Field id="lastName" label="Last name">
            <Input id="lastName" name="lastName" maxLength={80} />
          </Field>
          <Field id="firstName" label="First name">
            <Input id="firstName" name="firstName" maxLength={80} />
          </Field>
          <Field id="middleName" label="Middle name">
            <Input id="middleName" name="middleName" maxLength={80} />
          </Field>
          <Field id="businessName" label="Business / institution name">
            <Input id="businessName" name="businessName" maxLength={160} placeholder="Only for businesses and institutions" />
          </Field>
        </>
      )}

      <Field id="address" label={type === "MEMBER" ? "Address (blank = member's address)" : "Address"} className="sm:col-span-2">
        <Input id="address" name="address" maxLength={300} />
      </Field>
      <Field id="mobile" label="Mobile no.">
        <Input id="mobile" name="mobile" maxLength={20} inputMode="tel" />
      </Field>
      <Field id="email" label="E-mail">
        <Input id="email" name="email" type="email" maxLength={200} />
      </Field>
      <Field id="validIdType" label="Valid ID type">
        <Input id="validIdType" name="validIdType" maxLength={60} placeholder="e.g. PhilSys ID" />
      </Field>
      <Field id="validIdNo" label="Valid ID no.">
        <Input id="validIdNo" name="validIdNo" maxLength={40} />
      </Field>
      <Field id="remarks" label="Remarks" className="sm:col-span-2">
        <Textarea id="remarks" name="remarks" maxLength={500} rows={2} />
      </Field>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="privacyConsent" className="mt-1" />
        <span>I consent to PCMPC collecting and processing this personal data for water service (Data Privacy Act of 2012).</span>
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Err error={error} />
        <div>
          <Button type="submit" disabled={pending}>
            Save customer
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ApplicationForm({ customerId, routes }: { customerId: string; routes: Array<{ id: string; code: string; name: string }> }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[12rem_1fr_12rem_auto] sm:items-end"
      action={(fd) =>
        run(
          () =>
            createApplicationAction({
              customerId,
              classification: get(fd, "classification") as Class,
              serviceAddress: get(fd, "serviceAddress"),
              routeId: opt(fd, "routeId"),
            }),
          { success: "Application filed." },
        )
      }
    >
      <Field id="classification" label="Classification">
        <select id="classification" name="classification" defaultValue="RESIDENTIAL" className={selectClass}>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field id="serviceAddress" label="Service address">
        <Input id="serviceAddress" name="serviceAddress" maxLength={300} required />
      </Field>
      <Field id="routeId" label="Reading route">
        <select id="routeId" name="routeId" defaultValue="" className={selectClass}>
          <option value="">Default route</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={pending}>
        File application
      </Button>
      <div className="sm:col-span-4">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

// ── Applications ──

export function ApplicationDecision({ applicationId, canInspect, canApprove, inspected }: { applicationId: string; canInspect: boolean; canApprove: boolean; inspected: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      {canInspect && !inspected ? (
        <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => inspectApplicationAction({ applicationId, notes: get(fd, "notes") }))}>
          <Field id="notes" label="Inspection notes" className="min-w-72 flex-1">
            <Input id="notes" name="notes" maxLength={1000} />
          </Field>
          <Button type="submit" variant="outline" disabled={pending}>
            Record inspection
          </Button>
        </form>
      ) : null}
      {canApprove ? (
        <div className="flex flex-wrap items-end gap-2">
          <Button type="button" disabled={pending} onClick={() => run(() => approveApplicationAction({ applicationId }))}>
            Approve application
          </Button>
          <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => rejectApplicationAction({ applicationId, reason: get(fd, "reason") }))}>
            <Input name="reason" aria-label="Reason for rejecting" placeholder="Reason for rejecting" maxLength={300} required className="w-72" />
            <Button type="submit" variant="destructive" disabled={pending}>
              Reject
            </Button>
          </form>
        </div>
      ) : null}
      <Err error={error} />
    </div>
  );
}

export function InstallForm({ applicationId }: { applicationId: string }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => run(() => installMeterAction({ applicationId, meterSerial: get(fd, "meterSerial"), initialReading: int(fd, "initialReading") }))}
    >
      <Field id="meterSerial" label="Meter serial no.">
        <Input id="meterSerial" name="meterSerial" maxLength={40} required className="w-48" />
      </Field>
      <Field id="initialReading" label="Initial reading">
        <Input id="initialReading" name="initialReading" inputMode="numeric" pattern="[0-9]*" required className="w-32" />
      </Field>
      <Button type="submit" disabled={pending}>
        Install meter
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

// ── Meters ──

export function AddMeterForm() {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(() => addMeterAction({ serialNo: get(fd, "serialNo"), brand: opt(fd, "brand"), size: opt(fd, "size"), digits: int(fd, "digits") }), { success: "Meter added." })
      }
    >
      <Field id="serialNo" label="Serial no.">
        <Input id="serialNo" name="serialNo" maxLength={40} required className="w-48" />
      </Field>
      <Field id="brand" label="Brand">
        <Input id="brand" name="brand" maxLength={60} className="w-40" />
      </Field>
      <Field id="size" label="Size">
        <Input id="size" name="size" maxLength={20} placeholder="1/2 in" className="w-28" />
      </Field>
      <Field id="digits" label="Dial digits">
        <Input id="digits" name="digits" defaultValue="4" inputMode="numeric" className="w-24" />
      </Field>
      <Button type="submit" disabled={pending}>
        Add meter
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function MeterStatusSelect({ meterId, status, serialNo }: { meterId: string; status: string; serialNo: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <select
        aria-label={`Status of ${serialNo}`}
        value={status}
        disabled={pending}
        onChange={(e) => run(() => setMeterStatusAction({ meterId, status: e.target.value as "IN_STOCK" | "DEFECTIVE" | "RETIRED" }))}
        className={`${selectClass} w-36`}
      >
        <option value="IN_STOCK">IN_STOCK</option>
        <option value="DEFECTIVE">DEFECTIVE</option>
        <option value="RETIRED">RETIRED</option>
      </select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

// ── Account profile ──

export function ActivateButton({ accountId }: { accountId: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => activateAccountAction({ accountId }))}>
        Activate account
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function ReplaceMeterForm({ accountId }: { accountId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      action={(fd) =>
        run(
          () =>
            replaceMeterAction({
              accountId,
              oldFinalReading: int(fd, "oldFinalReading"),
              oldMeterStatus: get(fd, "oldMeterStatus") as "IN_STOCK" | "DEFECTIVE" | "RETIRED",
              newMeterSerial: get(fd, "newMeterSerial"),
              newInitialReading: int(fd, "newInitialReading"),
              reason: get(fd, "replaceReason"),
            }),
          { success: "Meter replaced." },
        )
      }
    >
      <Field id="oldFinalReading" label="Old meter final reading">
        <Input id="oldFinalReading" name="oldFinalReading" inputMode="numeric" required />
      </Field>
      <Field id="oldMeterStatus" label="Old meter becomes">
        <select id="oldMeterStatus" name="oldMeterStatus" defaultValue="DEFECTIVE" className={selectClass}>
          <option value="DEFECTIVE">DEFECTIVE</option>
          <option value="RETIRED">RETIRED</option>
          <option value="IN_STOCK">IN_STOCK</option>
        </select>
      </Field>
      <Field id="replaceReason" label="Reason for replacing">
        <Input id="replaceReason" name="replaceReason" maxLength={300} required />
      </Field>
      <Field id="newMeterSerial" label="New meter serial no.">
        <Input id="newMeterSerial" name="newMeterSerial" maxLength={40} required />
      </Field>
      <Field id="newInitialReading" label="New meter initial reading">
        <Input id="newInitialReading" name="newInitialReading" inputMode="numeric" required />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="outline" disabled={pending}>
          Replace meter
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function TransferForm({ accountId }: { accountId: string }) {
  const { pending, error, done, run } = useAction();
  const lookup = useAction();
  const [to, setTo] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field id="newCustomerNo" label="New owner's customer no.">
          <Input id="newCustomerNo" placeholder="WC-000002" className="w-44" />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={lookup.pending}
          onClick={() => {
            const el = document.getElementById("newCustomerNo") as HTMLInputElement | null;
            lookup.run(() => findCustomerAction({ customerNo: el?.value ?? "" }), { onSuccess: setTo });
          }}
        >
          Find customer
        </Button>
      </div>
      <Err error={lookup.error} />
      {to ? (
        <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => transferAccountAction({ accountId, newCustomerId: to.id, reason: get(fd, "transferReason") }), { success: "Account transferred." })}>
          <p className="w-full text-sm">
            Transfer to <span className="font-medium">{to.name}</span>. The deposit stays with the account.
          </p>
          <Field id="transferReason" label="Reason for the transfer">
            <Input id="transferReason" name="transferReason" maxLength={300} required className="w-72" />
          </Field>
          <Button type="submit" disabled={pending}>
            Transfer account
          </Button>
        </form>
      ) : null}
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

export function SeniorForm({ accountId }: { accountId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4 sm:items-end"
      action={(fd) =>
        run(
          () =>
            addSeniorEligibilityAction({ accountId, seniorName: get(fd, "seniorName"), oscaIdNo: get(fd, "oscaIdNo"), validFrom: get(fd, "validFrom"), validUntil: get(fd, "validUntil") }),
          { success: "Eligibility recorded." },
        )
      }
    >
      <Field id="seniorName" label="Senior citizen's name">
        <Input id="seniorName" name="seniorName" maxLength={160} required />
      </Field>
      <Field id="oscaIdNo" label="OSCA ID no.">
        <Input id="oscaIdNo" name="oscaIdNo" maxLength={40} required />
      </Field>
      <Field id="validFrom" label="Valid from">
        <Input id="validFrom" name="validFrom" type="date" required />
      </Field>
      <Field id="validUntil" label="Valid until">
        <Input id="validUntil" name="validUntil" type="date" required />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" variant="outline" disabled={pending}>
          Add eligibility
        </Button>
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

export function MoveRouteForm({ accountId, routeId, routes }: { accountId: string; routeId: string; routes: Array<{ id: string; code: string; name: string }> }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => moveAccountToRouteAction({ accountId, routeId: get(fd, "moveRouteId") }))}>
      <Field id="moveRouteId" label="Move to route">
        <select id="moveRouteId" name="moveRouteId" defaultValue={routeId} className={`${selectClass} w-56`}>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Move
      </Button>
      <Err error={error} />
    </form>
  );
}

// ── Routes ──

type SeqRow = { id: string; accountNo: string; customerName: string; serviceAddress: string; classification: string; status: string; meterSerial: string | null };

/** Reading order of one route: drag rows (or use ↑/↓) to reorder, then save. Key it on the saved order so it resets after a save. */
export function RouteSequence({ routeId, accounts, canEdit }: { routeId: string; accounts: SeqRow[]; canEdit: boolean }) {
  const { pending, error, done, run } = useAction();
  const [orderIds, setOrderIds] = useState(() => accounts.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const order = orderIds.map((id) => byId.get(id)).filter((a): a is SeqRow => !!a);
  const setOrder = (rows: SeqRow[]) => setOrderIds(rows.map((a) => a.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const dirty = order.some((a, i) => a.id !== accounts[i]?.id);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    setOrder(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-2 py-1.5">Seq.</th>
              <th className="px-2 py-1.5">Account no.</th>
              <th className="px-2 py-1.5">Customer</th>
              <th className="px-2 py-1.5">Service address</th>
              <th className="px-2 py-1.5">Class</th>
              <th className="px-2 py-1.5">Meter</th>
              <th className="px-2 py-1.5">Status</th>
              {canEdit ? <th className="px-2 py-1.5 sr-only">Reorder</th> : null}
            </tr>
          </thead>
          <tbody>
            {order.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">
                  No accounts on this route yet.
                </td>
              </tr>
            ) : null}
            {order.map((a, i) => (
              <tr
                key={a.id}
                draggable={canEdit}
                onDragStart={() => setDragId(a.id)}
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={() => {
                  const from = order.findIndex((x) => x.id === dragId);
                  if (from >= 0) move(from, i);
                  setDragId(null);
                }}
                className={`border-b ${canEdit ? "cursor-grab" : ""} ${dragId === a.id ? "opacity-50" : ""}`}
              >
                <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  <Link href={`/water/connections/${a.id}`} className="underline-offset-4 hover:underline">
                    {a.accountNo}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{a.customerName}</td>
                <td className="px-2 py-1.5">{a.serviceAddress}</td>
                <td className="px-2 py-1.5 text-xs">{a.classification}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{a.meterSerial ?? "—"}</td>
                <td className="px-2 py-1.5 text-xs">{a.status}</td>
                {canEdit ? (
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${a.accountNo} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                      ↑
                    </Button>
                    <Button type="button" size="sm" variant="ghost" aria-label={`Move ${a.accountNo} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>
                      ↓
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && dirty ? (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => reorderRouteAction({ routeId, accountIds: order.map((a) => a.id) }), { success: "Reading order saved." })}>
            Save reading order
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setOrder(accounts)}>
            Undo
          </Button>
        </div>
      ) : null}
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

// ── Tariffs ──

type BlockRow = { from: string; to: string; rate: string };

export function RateScheduleForm() {
  const { pending, error, done, run } = useAction();
  const [blocks, setBlocks] = useState<BlockRow[]>([
    { from: "11", to: "20", rate: "" },
    { from: "21", to: "", rate: "" },
  ]);
  const setBlock = (i: number, patch: Partial<BlockRow>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <form
      className="flex flex-col gap-4"
      action={(fd) =>
        run(
          () =>
            addRateScheduleAction({
              classification: get(fd, "rsClass") as Class,
              effectiveFrom: get(fd, "effectiveFrom"),
              minCharge: get(fd, "minCharge"),
              minCubic: int(fd, "minCubic"),
              nwrbRef: get(fd, "nwrbRef"),
              blocks: blocks.map((b) => ({ from: Number(b.from), to: b.to.trim() === "" ? null : Number(b.to), rate: b.rate })),
            }),
          { success: "Rate version added." },
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-5">
        <Field id="rsClass" label="Classification">
          <select id="rsClass" name="rsClass" defaultValue="RESIDENTIAL" className={selectClass}>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field id="effectiveFrom" label="Effective from">
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
        </Field>
        <Field id="minCharge" label="Minimum charge (₱)">
          <Input id="minCharge" name="minCharge" inputMode="decimal" placeholder="200.00" required />
        </Field>
        <Field id="minCubic" label="Minimum covers (m³)">
          <Input id="minCubic" name="minCubic" inputMode="numeric" defaultValue="10" required />
        </Field>
        <Field id="nwrbRef" label="NWRB approval ref.">
          <Input id="nwrbRef" name="nwrbRef" maxLength={200} required />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Blocks above the minimum (leave the last block&apos;s &quot;to&quot; blank)</legend>
        {blocks.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Block ${i + 1} from m³`} value={b.from} onChange={(e) => setBlock(i, { from: e.target.value })} className="w-24" inputMode="numeric" />
            <span className="text-sm">to</span>
            <Input aria-label={`Block ${i + 1} to m³`} value={b.to} onChange={(e) => setBlock(i, { to: e.target.value })} className="w-24" inputMode="numeric" placeholder="and up" />
            <span className="text-sm">m³ at ₱</span>
            <Input aria-label={`Block ${i + 1} rate per m³`} value={b.rate} onChange={(e) => setBlock(i, { rate: e.target.value })} className="w-28" inputMode="decimal" placeholder="25.00" />
            <span className="text-sm">per m³</span>
            {blocks.length > 1 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setBlocks([...blocks, { from: "", to: "", rate: "" }])}>
            Add block
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Err error={error} />
        <Done done={done} />
        <div>
          <Button type="submit" disabled={pending}>
            Add rate version
          </Button>
        </div>
      </div>
    </form>
  );
}
