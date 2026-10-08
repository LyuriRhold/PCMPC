"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "@/lib/money";
import { closeSessionAction } from "../actions";

export type Denomination = { value: string; kind: "BILL" | "COIN" };

function label(d: Denomination): string {
  const v = BigInt(d.value);
  const peso = v % 100n === 0n ? `₱${(v / 100n).toLocaleString("en-PH")}` : `₱${format(v).replace("₱", "")}`;
  return `${peso} ${d.kind === "BILL" ? "bills" : "coins"}`;
}

/** Cash count by denomination; closing the session compares it with the expected cash. */
export function CashCountForm({ sessionId, denominations, expected }: { sessionId: string; denominations: Denomination[]; expected: string }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ expected: string; counted: string; variance: string } | null>(null);
  const key = (d: Denomination) => `${d.value}:${d.kind}`;
  const total = denominations.reduce((s, d) => {
    const n = qty[key(d)];
    return s + (n && /^\d+$/.test(n) ? BigInt(d.value) * BigInt(n) : 0n);
  }, 0n);

  if (result) {
    const v = BigInt(result.variance);
    return (
      <div className="flex max-w-md flex-col gap-1 rounded-lg border p-4 text-sm">
        <p className="font-semibold">Session closed</p>
        <p>Expected: {format(BigInt(result.expected))}</p>
        <p>Counted: {format(BigInt(result.counted))}</p>
        <p className={v === 0n ? "text-green-700" : "text-destructive"}>
          Variance: {format(v)}
          {v < 0n ? " (short)" : v > 0n ? " (over)" : ""}
        </p>
        <p className="text-xs text-muted-foreground">A manager verifies the session; any variance is posted then.</p>
      </div>
    );
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      action={() =>
        start(async () => {
          setError(null);
          try {
            const r = await closeSessionAction({
              sessionId,
              counts: denominations.map((d) => ({ denomination: format(BigInt(d.value)).replace("₱", "").replaceAll(",", ""), kind: d.kind, qty: Number(qty[key(d)] || 0) })),
            });
            if (!r.ok) return setError(r.error);
            setResult(r.data);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong");
          }
        })
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {denominations.map((d) => (
          <div key={key(d)} className="flex items-center justify-between gap-2">
            <Label htmlFor={`d-${key(d)}`} className="text-sm">
              {label(d)}
            </Label>
            <Input
              id={`d-${key(d)}`}
              className="w-20 text-right tabular-nums"
              inputMode="numeric"
              value={qty[key(d)] ?? ""}
              onChange={(e) => setQty((q) => ({ ...q, [key(d)]: e.target.value.replace(/\D/g, "") }))}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <span>
          Counted: <span className="font-semibold tabular-nums" data-testid="count-total">{format(total)}</span>
        </span>
        <span className="text-muted-foreground">Expected: {format(BigInt(expected))}</span>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Close session
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
