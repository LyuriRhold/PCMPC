"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, parse } from "@/lib/money";
import { createJvDraftAction } from "../actions";

export type AccountOption = { id: string; code: string; name: string; requiresMember: boolean };

type Line = { key: number; accountId: string; memberNo: string; debit: string; credit: string; memo: string };

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Centavos for a typed amount, or null if it isn't a valid peso amount (blank = 0). */
function centavos(text: string): bigint | null {
  if (!text.trim()) return 0n;
  try {
    return parse(text);
  } catch {
    return null;
  }
}

const blank = (key: number): Line => ({ key, accountId: "", memberNo: "", debit: "", credit: "", memo: "" });

/** Manual journal voucher (General Journal). Saved as a draft; another user approves and posts it. */
export function JvForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([blank(1), blank(2)]);
  const [nextKey, setNextKey] = useState(3);
  const [date, setDate] = useState(today);
  const [particulars, setParticulars] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parsed = lines.map((l) => ({ dr: centavos(l.debit), cr: centavos(l.credit) }));
  const invalid = parsed.some((p) => p.dr === null || p.cr === null);
  const dr = parsed.reduce((s, p) => s + (p.dr ?? 0n), 0n);
  const cr = parsed.reduce((s, p) => s + (p.cr ?? 0n), 0n);
  const balanced = !invalid && dr === cr && dr > 0n;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await createJvDraftAction({
          date,
          particulars,
          reference,
          lines: lines.map(({ accountId, debit, credit, memberNo, memo }) => ({ accountId, debit, credit, memberNo, memo })),
        });
        if (!r.ok) return setError(r.error);
        router.push(`/accounting/journals/${r.data.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid max-w-4xl gap-3 sm:grid-cols-[10rem_1fr_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jv-date">Date</Label>
          <Input id="jv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jv-particulars">Particulars</Label>
          <Input id="jv-particulars" value={particulars} onChange={(e) => setParticulars(e.target.value)} maxLength={500} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jv-reference">Reference (optional)</Label>
          <Input id="jv-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-8 py-2">#</th>
              <th className="py-2">Account</th>
              <th className="w-32 py-2">Member no.</th>
              <th className="w-36 py-2 text-right">Debit</th>
              <th className="w-36 py-2 text-right">Credit</th>
              <th className="py-2">Memo</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const n = i + 1;
              const needsMember = byId.get(l.accountId)?.requiresMember ?? false;
              return (
                <tr key={l.key} className="border-b align-top">
                  <td className="py-2 text-muted-foreground tabular-nums">{n}</td>
                  <td className="py-2 pr-2">
                    <select aria-label={`Account, line ${n}`} className={selectClass} value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })}>
                      <option value="">Choose an account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      aria-label={`Member no., line ${n}`}
                      value={l.memberNo}
                      onChange={(e) => update(l.key, { memberNo: e.target.value })}
                      placeholder={needsMember ? "Required" : ""}
                      aria-invalid={needsMember && !l.memberNo ? true : undefined}
                      disabled={!needsMember && !l.memberNo}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      aria-label={`Debit, line ${n}`}
                      value={l.debit}
                      onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      aria-invalid={parsed[i]?.dr === null ? true : undefined}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      aria-label={`Credit, line ${n}`}
                      value={l.credit}
                      onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      aria-invalid={parsed[i]?.cr === null ? true : undefined}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input aria-label={`Memo, line ${n}`} value={l.memo} onChange={(e) => update(l.key, { memo: e.target.value })} maxLength={200} />
                  </td>
                  <td className="py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove line ${n}`}
                      disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td colSpan={3} className="py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLines((ls) => [...ls, blank(nextKey)]);
                    setNextKey((k) => k + 1);
                  }}
                >
                  <Plus className="size-4" aria-hidden /> Add line
                </Button>
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{format(dr)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{format(cr)}</td>
              <td colSpan={2} className="py-2" data-testid="jv-totals">
                {invalid ? (
                  <span className="text-destructive">Check the amounts</span>
                ) : balanced ? (
                  <span className="text-green-700">Balanced</span>
                ) : (
                  <span className="text-destructive">Out of balance by {format(dr > cr ? dr - cr : cr - dr)}</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || !balanced}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <span className="text-xs text-muted-foreground">Another user with approval rights posts it.</span>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
