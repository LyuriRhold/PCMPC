"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { approveMemberAction, changeMemberStatusAction, setBeneficiariesAction } from "../actions";
import { pctToHundredths, type BeneficiaryInput } from "../validation";
import { selectClass } from "./member-form";

function Message({ error, done }: { error: string | null; done?: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  return done ? <p className="text-sm text-green-700">{done}</p> : null;
}

/** Board approval: PMES date, BOD resolution no. and consent, then the member no. is assigned. */
export function ApprovePanel({
  memberId,
  pmesDate,
  bodResolutionNo,
  hasConsent,
}: {
  memberId: string;
  pmesDate: string | null;
  bodResolutionNo: string | null;
  hasConsent: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await approveMemberAction({
          memberId,
          pmesDate: String(fd.get("pmesDate") ?? "") || null,
          bodResolutionNo: String(fd.get("bodResolutionNo") ?? "") || null,
          privacyConsent: hasConsent || fd.get("privacyConsent") === "on",
        });
        if (!r.ok) return setError(r.error);
        router.replace(`/members/${memberId}?approved=${encodeURIComponent(r.data.memberNo)}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-50/50 p-4 dark:bg-amber-950/20">
      <h2 className="text-sm font-semibold">Approve membership</h2>
      <p className="text-xs text-muted-foreground">
        Requires the PMES date, the Board resolution number and the applicant&apos;s privacy consent. The next member
        number is assigned and the membership date is today&apos;s business date.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-pmes">PMES date</Label>
          <Input id="ap-pmes" name="pmesDate" type="date" defaultValue={pmesDate ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-bod">BOD resolution no.</Label>
          <Input id="ap-bod" name="bodResolutionNo" defaultValue={bodResolutionNo ?? ""} maxLength={40} />
        </div>
      </div>
      {hasConsent ? (
        <p className="text-xs text-muted-foreground">Privacy consent: given.</p>
      ) : (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacyConsent" className="mt-1" />
          <span>The applicant has signed the privacy consent.</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Approving…" : "Approve membership"}
        </Button>
        <Message error={error} />
      </div>
    </form>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  TERMINATED: "Terminated",
  DECEASED: "Deceased",
};

export function StatusChangeForm({ memberId, targets }: { memberId: string; targets: string[] }) {
  const { pending, error, done, run } = useAction();
  if (targets.length === 0) return <p className="text-sm text-muted-foreground">No further status changes are possible.</p>;
  function submit(fd: FormData) {
    const to = String(fd.get("to") ?? "") as "ACTIVE" | "INACTIVE" | "TERMINATED" | "DECEASED";
    if ((to === "TERMINATED" || to === "DECEASED") && !window.confirm(`${STATUS_LABEL[to]} is final and can't be undone. Continue?`)) return;
    run(
      () =>
        changeMemberStatusAction({
          memberId,
          to,
          reason: String(fd.get("reason") ?? ""),
          ref: String(fd.get("ref") ?? "") || null,
        }),
      { success: "Status changed." },
    );
  }
  return (
    <form action={submit} className="grid max-w-2xl gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-to">New status</Label>
        <select id="st-to" name="to" className={selectClass} defaultValue={targets[0]}>
          {targets.map((t) => (
            <option key={t} value={t}>
              {STATUS_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-reason">Reason</Label>
        <Input id="st-reason" name="reason" required maxLength={300} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-ref">Reference (optional)</Label>
        <Input id="st-ref" name="ref" maxLength={80} placeholder="BOD Res. no." />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Change status
      </Button>
      <div className="sm:col-span-4">
        <Message error={error} done={done} />
      </div>
    </form>
  );
}

type Row = BeneficiaryInput & { key: number };

/** Edit the full beneficiary list; shares must total exactly 100% (checked again on the server). */
export function BeneficiariesEditor({ memberId, initial }: { memberId: string; initial: BeneficiaryInput[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((b, i) => ({ ...b, key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  const { pending, error, done, run } = useAction();

  const valid = (p: string) => /^\d{1,3}(\.\d{1,2})?$/.test(p.trim());
  const total = rows.reduce((s, r) => s + (valid(r.sharePct) ? pctToHundredths(r.sharePct) : 0), 0);
  const totalText = `${Math.floor(total / 100)}${total % 100 ? `.${String(total % 100).padStart(2, "0")}` : ""}%`;

  const update = (key: number, patch: Partial<BeneficiaryInput>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No beneficiaries yet.</p> : null}
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_9rem_10rem_6rem_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`b-name-${r.key}`}>Name {i + 1}</Label>
            <Input id={`b-name-${r.key}`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} maxLength={120} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`b-rel-${r.key}`}>Relationship</Label>
            <Input id={`b-rel-${r.key}`} value={r.relationship} onChange={(e) => update(r.key, { relationship: e.target.value })} maxLength={40} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`b-bd-${r.key}`}>Birthdate</Label>
            <Input id={`b-bd-${r.key}`} type="date" value={r.birthdate ?? ""} onChange={(e) => update(r.key, { birthdate: e.target.value || null })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`b-pct-${r.key}`}>Share %</Label>
            <Input id={`b-pct-${r.key}`} value={r.sharePct} onChange={(e) => update(r.key, { sharePct: e.target.value })} inputMode="decimal" />
          </div>
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove beneficiary ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, name: "", relationship: "", birthdate: null, sharePct: "" }]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="size-4" aria-hidden /> Add beneficiary
        </Button>
        <span className={`text-sm tabular-nums ${rows.length && total !== 10000 ? "text-destructive" : "text-muted-foreground"}`}>
          Total: {totalText}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setBeneficiariesAction({
                  memberId,
                  beneficiaries: rows.map(({ name, relationship, birthdate, sharePct }) => ({ name, relationship, birthdate, sharePct })),
                }),
              { success: "Beneficiaries saved." },
            )
          }
        >
          {pending ? "Saving…" : "Save beneficiaries"}
        </Button>
      </div>
      <Message error={error} done={done} />
    </div>
  );
}
