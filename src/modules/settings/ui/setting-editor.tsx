"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/use-action";
import { parse as parseMoney } from "@/lib/money";
import { percentToFraction } from "@/lib/rates";
import type { SettingKind } from "../registry";
import { updateSettingAction } from "../actions";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Converts what the person typed into the stored JSON value for the setting's kind. */
function toStoredValue(kind: SettingKind, text: string): unknown {
  switch (kind) {
    case "money":
      return parseMoney(text).toString();
    case "rate":
      return percentToFraction(text);
    case "int": {
      if (!/^-?\d+$/.test(text.trim())) throw new Error("Enter a whole number");
      return Number(text.trim());
    }
    case "bool":
      return text === "true";
    case "json":
      return JSON.parse(text);
    case "text":
    case "enum":
      return text;
  }
}

export function SettingEditor({
  settingKey,
  kind,
  initial,
  options,
}: {
  settingKey: string;
  kind: SettingKind;
  /** The current value as the person edits it (pesos, percent, JSON text, …). */
  initial: string;
  options?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const { pending, error, run } = useAction();

  if (!editing) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} aria-label={`Edit ${settingKey}`}>
        Edit
      </Button>
    );
  }

  function save() {
    setLocalError(null);
    let value: unknown;
    try {
      value = toStoredValue(kind, text);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Invalid value");
      return;
    }
    run(() => updateSettingAction({ key: settingKey, value }), { onSuccess: () => setEditing(false) });
  }

  const field =
    kind === "json" ? (
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-xs" />
    ) : kind === "bool" ? (
      <select value={text} onChange={(e) => setText(e.target.value)} className={selectClass}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    ) : kind === "enum" && options ? (
      <select value={text} onChange={(e) => setText(e.target.value)} className={selectClass}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    ) : (
      <div className="flex items-center gap-1">
        {kind === "money" ? <span className="text-sm text-muted-foreground">₱</span> : null}
        <Input value={text} onChange={(e) => setText(e.target.value)} className="w-48" inputMode={kind === "text" ? "text" : "decimal"} />
        {kind === "rate" ? <span className="text-sm text-muted-foreground">%</span> : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {field}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setText(initial);
            setLocalError(null);
          }}
        >
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
