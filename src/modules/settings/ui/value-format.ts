import { format as formatMoney, parse as parseMoney } from "@/lib/money";
import { fractionToPercent, percentToFraction } from "@/lib/rates";
import { MONTH_NAMES, type FieldSpec } from "../presentation";

/**
 * Conversions between a setting's stored value and what people see and type (pesos, percent,
 * Yes/No, choices). Shared by the settings page (display) and the editor (draft ↔ stored).
 */

export type Draft = string | boolean | Draft[] | { [k: string]: Draft };
export type IncomeAccounts = Record<string, string>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value as a short sentence or list of lines. */
export function describe(spec: FieldSpec, value: unknown, accounts: IncomeAccounts = {}): string {
  if (value === null || value === undefined || value === "") {
    if (spec.type === "number" && spec.blankLabel) return spec.blankLabel;
    return "—";
  }
  switch (spec.type) {
    case "text":
      return String(value);
    case "money":
      return formatMoney(BigInt(String(value)));
    case "percent":
      return `${fractionToPercent(String(value))}%${spec.suffix ? ` ${spec.suffix}` : ""}`;
    case "number":
      return `${Number(value).toLocaleString("en-US")}${spec.unit ? ` ${spec.unit}` : ""}`;
    case "times":
      return `${String(value).replace(/\.0+$/, "")}×`;
    case "yesno":
      return value ? (spec.yes ?? "Yes") : (spec.no ?? "No");
    case "choice":
      return spec.options[String(value)] ?? String(value);
    case "month":
      return MONTH_NAMES[Number(value) - 1] ?? String(value);
    case "sequence":
      return Array.isArray(value) ? value.map((v) => spec.items[String(v)] ?? String(v)).join(" → ") : String(value);
    case "incomeAccount":
      return accounts[String(value)] ?? String(value);
    case "code":
      return String(value);
    case "form":
      if (!isObj(value)) return String(value);
      return spec.fields.map((f) => `${f.label}: ${describe(f.spec, value[f.key], accounts)}${f.help && f.spec.type === "times" ? ` ${f.help}` : ""}`).join("\n");
    case "list":
      if (!Array.isArray(value)) return String(value);
      return value
        .map((row) =>
          isObj(row)
            ? spec.columns
                .filter((c) => c.spec.type !== "code")
                .map((c) => describe(c.spec, row[c.key], accounts))
                .join(" · ")
            : String(row),
        )
        .join("\n");
    case "map":
      if (!isObj(value)) return String(value);
      return Object.entries(value)
        .map(([k, v]) => `${k}: ${v === null ? spec.blankLabel : describe(spec.valueSpec, v, accounts)}`)
        .join("\n");
  }
}

/** Stored value → what the editor's fields hold. */
export function toDraft(spec: FieldSpec, value: unknown): Draft {
  switch (spec.type) {
    case "money":
      return value === null || value === undefined ? "" : formatMoney(BigInt(String(value))).replace("₱", "").replaceAll(",", "");
    case "percent":
      return value === null || value === undefined ? "" : fractionToPercent(String(value));
    case "number":
      return value === null || value === undefined ? "" : String(value);
    case "yesno":
      return Boolean(value);
    case "sequence":
      return Array.isArray(value) ? value.map(String) : Object.keys(spec.items);
    case "form":
      return Object.fromEntries(spec.fields.map((f) => [f.key, toDraft(f.spec, isObj(value) ? value[f.key] : undefined)]));
    case "list":
      return Array.isArray(value) ? value.map((row) => Object.fromEntries(spec.columns.map((c) => [c.key, toDraft(c.spec, isObj(row) ? row[c.key] : undefined)]))) : [];
    case "map":
      return isObj(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toDraft(spec.valueSpec, v)])) : {};
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

/** A field that can't be saved; the message is shown next to the form. */
export class DraftError extends Error {}

/** What the editor's fields hold → the value to store. Throws DraftError with a plain message. */
export function fromDraft(spec: FieldSpec, draft: Draft, label: string): unknown {
  const text = typeof draft === "string" ? draft.trim() : "";
  switch (spec.type) {
    case "text":
    case "choice":
    case "incomeAccount":
      if (spec.type !== "text" && !text) throw new DraftError(`${label}: choose one`);
      return text;
    case "code":
      return text.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    case "money":
      try {
        return parseMoney(text).toString();
      } catch {
        throw new DraftError(`${label}: enter an amount in pesos, e.g. 300.00`);
      }
    case "percent":
      if (text === "") return null;
      try {
        return percentToFraction(text.replace(/%$/, ""));
      } catch {
        throw new DraftError(`${label}: enter a percentage, e.g. 10`);
      }
    case "number": {
      if (text === "" && spec.blankLabel) return null;
      if (!/^\d+$/.test(text)) throw new DraftError(`${label}: enter a whole number`);
      const n = Number(text);
      if (spec.min !== undefined && n < spec.min) throw new DraftError(`${label}: must be at least ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) throw new DraftError(`${label}: must be at most ${spec.max}`);
      return n;
    }
    case "times":
      if (!/^\d+(\.\d+)?$/.test(text)) throw new DraftError(`${label}: enter a number, e.g. 2 or 1.5`);
      return text.includes(".") ? text : `${text}.0`;
    case "yesno":
      return draft === true;
    case "month":
      return Number(text);
    case "sequence": {
      const items = Array.isArray(draft) ? draft.map(String) : [];
      if (new Set(items).size !== items.length) throw new DraftError(`${label}: each item can appear only once`);
      return items;
    }
    case "form": {
      const obj = (draft ?? {}) as Record<string, Draft>;
      return Object.fromEntries(spec.fields.map((f) => [f.key, fromDraft(f.spec, obj[f.key] ?? "", f.label)]));
    }
    case "list": {
      const rows = (Array.isArray(draft) ? draft : []) as Array<Record<string, Draft>>;
      if (rows.length === 0) throw new DraftError(`${label}: add at least one row`);
      return rows.map((row, i) =>
        Object.fromEntries(
          spec.columns.map((c) => {
            // A blank code is made from another column (e.g. "Hall rental" → HALL_RENTAL).
            const draftValue = c.spec.type === "code" && String(row[c.key] ?? "").trim() === "" ? (row[c.spec.from] ?? "") : (row[c.key] ?? "");
            const v = fromDraft(c.spec, draftValue, `Row ${i + 1} ${c.label.toLowerCase()}`);
            if (c.spec.type === "code" && (typeof v !== "string" || v.length < 2)) throw new DraftError(`Row ${i + 1}: enter a name`);
            return [c.key, v];
          }),
        ),
      );
    }
    case "map": {
      const obj = (draft ?? {}) as Record<string, Draft>;
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fromDraft(spec.valueSpec, v, k)]));
    }
  }
}
