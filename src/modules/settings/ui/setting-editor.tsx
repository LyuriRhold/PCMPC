"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/use-action";
import { updateSettingAction } from "../actions";
import { MONTH_NAMES, type FieldSpec } from "../presentation";
import { DraftError, fromDraft, toDraft, type Draft, type IncomeAccounts } from "./value-format";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** One field of the editor, for any kind of setting value (recursive for forms and lists). */
function Field({ spec, draft, onChange, label, accounts }: { spec: FieldSpec; draft: Draft; onChange: (d: Draft) => void; label: string; accounts: IncomeAccounts }) {
  const text = typeof draft === "string" ? draft : "";
  switch (spec.type) {
    case "text":
      return <Input value={text} onChange={(e) => onChange(e.target.value)} placeholder={spec.placeholder} aria-label={label} className="w-full min-w-44 max-w-sm" />;
    case "code":
      return <Input value={text} onChange={(e) => onChange(e.target.value)} placeholder="made from the name" aria-label={label} className="w-40 font-mono text-xs" />;
    case "money":
      return (
        <span className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">₱</span>
          <Input value={text} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={label} className="w-36" />
        </span>
      );
    case "percent":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <Input value={text} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={label} className="w-24" />
          <span className="text-sm text-muted-foreground">%{spec.suffix ? ` ${spec.suffix}` : ""}</span>
        </span>
      );
    case "number":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <Input value={text} onChange={(e) => onChange(e.target.value)} inputMode="numeric" aria-label={label} placeholder={spec.blankLabel} className="w-24" />
          {spec.unit ? <span className="text-sm text-muted-foreground">{spec.unit}</span> : null}
        </span>
      );
    case "times":
      return (
        <span className="flex items-center gap-1">
          <Input value={text} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={label} className="w-20" />
          <span className="text-sm text-muted-foreground">×</span>
        </span>
      );
    case "yesno":
      return (
        <select value={draft === true ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "yes")} aria-label={label} className={selectClass}>
          <option value="yes">{spec.yes ?? "Yes"}</option>
          <option value="no">{spec.no ?? "No"}</option>
        </select>
      );
    case "choice": {
      const entries = Object.entries(spec.options);
      if (entries.length === 1) return <span className="text-sm">{entries[0]![1]}</span>;
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)} aria-label={label} className={selectClass}>
          {entries.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    }
    case "incomeAccount":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${selectClass} max-w-64`}>
          <option value="">Choose an account…</option>
          {Object.entries(accounts).map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </select>
      );
    case "month":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)} aria-label={label} className={selectClass}>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
      );
    case "sequence": {
      const order = Array.isArray(draft) ? (draft as string[]) : [];
      return (
        <span className="flex flex-wrap items-center gap-1">
          {order.map((v, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <span className="text-muted-foreground">→</span> : null}
              <select value={v} onChange={(e) => onChange(order.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} ${i + 1}`} className={selectClass}>
                {Object.entries(spec.items).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </span>
          ))}
        </span>
      );
    }
    case "form": {
      const obj = (draft ?? {}) as Record<string, Draft>;
      return (
        <div className="flex flex-col gap-2">
          {spec.fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-sm sm:w-56">{f.label}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Field spec={f.spec} draft={obj[f.key] ?? ""} onChange={(d) => onChange({ ...obj, [f.key]: d })} label={f.label} accounts={accounts} />
                {f.help ? <span className="text-xs text-muted-foreground">{f.help}</span> : null}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "list": {
      const rows = (Array.isArray(draft) ? draft : []) as Array<Record<string, Draft>>;
      return (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-md border bg-background p-2">
              {spec.columns.map((c) => (
                <label key={c.key} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  <Field
                    spec={c.spec}
                    draft={row[c.key] ?? ""}
                    onChange={(d) => onChange(rows.map((r, j) => (j === i ? { ...r, [c.key]: d } : r)))}
                    label={`Row ${i + 1} ${c.label}`}
                    accounts={accounts}
                  />
                </label>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, toDraft({ ...spec, type: "form", fields: spec.columns }, spec.newRow)])}>
              {spec.addLabel}
            </Button>
          </div>
        </div>
      );
    }
    case "map": {
      const obj = (draft ?? {}) as Record<string, Draft>;
      return (
        <div className="flex flex-col gap-1">
          {Object.keys(obj).map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-24 text-sm">{k}</span>
              <Field spec={spec.valueSpec} draft={obj[k] ?? ""} onChange={(d) => onChange({ ...obj, [k]: d })} label={k} accounts={accounts} />
            </div>
          ))}
          <span className="text-xs text-muted-foreground">Leave blank if not set.</span>
        </div>
      );
    }
  }
}

export function SettingEditor({ settingKey, label, spec, value, accounts }: { settingKey: string; label: string; spec: FieldSpec; value: unknown; accounts: IncomeAccounts }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(spec, value));
  const [localError, setLocalError] = useState<string | null>(null);
  const { pending, error, run } = useAction();

  if (!editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          setDraft(toDraft(spec, value));
          setEditing(true);
        }}
        aria-label={`Change ${label}`}
      >
        Change
      </Button>
    );
  }

  function save() {
    setLocalError(null);
    let stored: unknown;
    try {
      stored = fromDraft(spec, draft, label);
    } catch (e) {
      setLocalError(e instanceof DraftError ? e.message : "Check the values entered");
      return;
    }
    run(() => updateSettingAction({ key: settingKey, value: stored }), { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <Field spec={spec} draft={draft} onChange={setDraft} label={label} accounts={accounts} />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => (setEditing(false), setLocalError(null))}>
          Cancel
        </Button>
      </div>
      {localError || error ? (
        <p role="alert" className="text-sm text-destructive">
          {localError ?? error}
        </p>
      ) : null}
    </div>
  );
}
