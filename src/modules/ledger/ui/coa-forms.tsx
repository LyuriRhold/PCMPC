"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { createAccountAction, setAccountActiveAction, updateAccountAction } from "../actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
type AccountType = (typeof TYPES)[number];
const NORMAL: Record<AccountType, "DR" | "CR"> = { ASSET: "DR", LIABILITY: "CR", EQUITY: "CR", REVENUE: "CR", EXPENSE: "DR" };

export type HeaderOption = { id: string; code: string; name: string; type: string };

function Msg({ error, done }: { error: string | null; done: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  return done ? <p className="text-sm text-green-700">{done}</p> : null;
}

export function AddAccountForm({ headers }: { headers: HeaderOption[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<AccountType>("EXPENSE");
  const [side, setSide] = useState<"DR" | "CR">("DR");
  const { pending, error, done, run } = useAction();
  const parents = headers.filter((h) => h.type === type);

  return (
    <form
      ref={form}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:items-end"
      action={(fd) =>
        run(
          () =>
            createAccountAction({
              code: String(fd.get("code") ?? ""),
              name: String(fd.get("name") ?? ""),
              type,
              normalBalance: side,
              parentId: String(fd.get("parentId") ?? "") || null,
              isPostable: fd.get("isPostable") === "on",
              scaCode: String(fd.get("scaCode") ?? "") || null,
            }),
          { success: "Account added.", onSuccess: () => form.current?.reset() },
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acc-code">Code</Label>
        <Input id="acc-code" name="code" required maxLength={20} />
      </div>
      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="acc-name">Account title</Label>
        <Input id="acc-name" name="name" required maxLength={120} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acc-type">Type</Label>
        <select
          id="acc-type"
          className={selectClass}
          value={type}
          onChange={(e) => {
            const t = e.target.value as AccountType;
            setType(t);
            setSide(NORMAL[t]);
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acc-side">Normal balance</Label>
        <select id="acc-side" className={selectClass} value={side} onChange={(e) => setSide(e.target.value as "DR" | "CR")}>
          <option value="DR">Debit</option>
          <option value="CR">Credit (contra if not usual)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="acc-parent">Under header</Label>
        <select id="acc-parent" name="parentId" className={selectClass} defaultValue="">
          <option value="">(top level)</option>
          {parents.map((h) => (
            <option key={h.id} value={h.id}>
              {h.code} · {h.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acc-sca">CDA SCA code</Label>
        <Input id="acc-sca" name="scaCode" maxLength={20} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPostable" defaultChecked /> Postable (uncheck for a header)
      </label>
      <div className="flex items-center gap-3 lg:col-span-5">
        <Button type="submit" disabled={pending}>
          Add account
        </Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function RenameAccount({ accountId, name, scaCode, parentId }: { accountId: string; name: string; scaCode: string | null; parentId: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const { pending, error, run } = useAction();
  if (!editing) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${name}`}>
        Rename
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 w-64" aria-label="New account title" />
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => updateAccountAction({ accountId, name: value, scaCode, parentId }), { onSuccess: () => setEditing(false) })}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

export function ToggleAccountActive({ accountId, active, label }: { accountId: string; active: boolean; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`${active ? "Deactivate" : "Activate"} ${label}`} onClick={() => run(() => setAccountActiveAction({ accountId, active: !active }))}>
        {active ? "Deactivate" : "Activate"}
      </Button>
      {error ? <span className="max-w-64 text-right text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
