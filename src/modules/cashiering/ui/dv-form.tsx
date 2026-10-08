"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, parse } from "@/lib/money";
import { createDvAction } from "../actions";

type Acct = { id: string; code: string; name: string; requiresMember: boolean };
type Line = { key: number; accountId: string; amount: string; memberNo: string; memo: string };

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function centavos(t: string): bigint {
  try {
    return t.trim() ? parse(t) : 0n;
  } catch {
    return 0n;
  }
}

/** Prepares a disbursement voucher: who is paid, what for, and the accounts debited. */
export function DvForm({ accounts, today }: { accounts: Acct[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([{ key: 1, accountId: "", amount: "", memberNo: "", memo: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [mode, setMode] = useState<"CASH" | "CHECK">("CASH");
  const total = lines.reduce((s, l) => s + centavos(l.amount), 0n);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return (
    <form
      className="flex flex-col gap-4"
      action={(fd) =>
        start(async () => {
          setError(null);
          try {
            const r = await createDvAction({
              date: String(fd.get("date") ?? today),
              payee: String(fd.get("payee") ?? ""),
              particulars: String(fd.get("particulars") ?? ""),
              mode,
              checkNo: mode === "CHECK" ? String(fd.get("checkNo") ?? "") : null,
              lines: lines.map(({ accountId, amount, memberNo, memo }) => ({ accountId, amount, memberNo, memo })),
            });
            if (!r.ok) return setError(r.error);
            router.push(`/cashiering/vouchers/${r.data.id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong");
          }
        })
      }
    >
      <div className="grid max-w-4xl gap-3 sm:grid-cols-[10rem_1fr_9rem_10rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dv-date">Date</Label>
          <Input id="dv-date" name="date" type="date" defaultValue={today} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dv-payee">Payee</Label>
          <Input id="dv-payee" name="payee" required maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dv-mode">Mode</Label>
          <select id="dv-mode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "CASH" | "CHECK")}>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
          </select>
        </div>
        {mode === "CHECK" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dv-check">Check no.</Label>
            <Input id="dv-check" name="checkNo" maxLength={40} />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 sm:col-span-4">
          <Label htmlFor="dv-particulars">Particulars</Label>
          <Input id="dv-particulars" name="particulars" required maxLength={500} />
        </div>
      </div>
      <table className="w-full max-w-4xl text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2">Account debited</th>
            <th className="w-32 py-2">Member no.</th>
            <th className="w-36 py-2 text-right">Amount</th>
            <th className="py-2">Memo</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key} className="border-b">
              <td className="py-2 pr-2">
                <select aria-label={`Account, line ${i + 1}`} className={selectClass} value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })}>
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Member no., line ${i + 1}`} value={l.memberNo} onChange={(e) => update(l.key, { memberNo: e.target.value })} disabled={!byId.get(l.accountId)?.requiresMember && !l.memberNo} />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Amount, line ${i + 1}`} value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} className="text-right tabular-nums" inputMode="decimal" />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Memo, line ${i + 1}`} value={l.memo} onChange={(e) => update(l.key, { memo: e.target.value })} maxLength={200} />
              </td>
              <td className="py-2">
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td colSpan={2} className="py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLines((ls) => [...ls, { key: nextKey, accountId: "", amount: "", memberNo: "", memo: "" }]);
                  setNextKey((k) => k + 1);
                }}
              >
                <Plus className="size-4" aria-hidden /> Add line
              </Button>
            </td>
            <td className="py-2 pr-2 text-right tabular-nums">{format(total)}</td>
            <td colSpan={2} className="py-2 text-xs text-muted-foreground">
              Credit: {mode === "CASH" ? "Cash on Hand" : "Cash in Bank"}
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save DV
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
