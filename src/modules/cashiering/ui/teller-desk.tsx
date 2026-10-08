"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format, parse } from "@/lib/money";
import { bankDepositAction, duesAction, issueReceiptAction, openSessionAction, searchPayorsAction } from "../actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function centavos(text: string): bigint | null {
  try {
    return text.trim() ? parse(text) : null;
  } catch {
    return null;
  }
}

function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function OpenSessionForm() {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex max-w-md flex-col gap-3 rounded-lg border p-4"
      action={(fd) => run(() => openSessionAction({ openingCash: String(fd.get("openingCash") ?? "") }))}
    >
      <h2 className="text-sm font-semibold">Open today&apos;s session</h2>
      <p className="text-xs text-muted-foreground">Count the cash fund you received before taking payments.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="openingCash">Opening cash</Label>
        <Input id="openingCash" name="openingCash" inputMode="decimal" required defaultValue="0.00" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Open session
        </Button>
        <Err error={error} />
      </div>
    </form>
  );
}

export function BankDepositForm() {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
      action={(fd) =>
        run(() => bankDepositAction({ amount: String(fd.get("amount") ?? ""), bankReference: String(fd.get("bankReference") ?? "") }), {
          success: "Deposit recorded.",
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dep-amount">Cash deposited</Label>
        <Input id="dep-amount" name="amount" inputMode="decimal" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dep-ref">Deposit slip / bank reference</Label>
        <Input id="dep-ref" name="bankReference" required maxLength={80} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Record deposit
      </Button>
      <div className="sm:col-span-3">
        <Err error={error} />
        {done ? <p className="text-sm text-green-700">{done}</p> : null}
      </div>
    </form>
  );
}

type CartItem = { key: number; type: string; refId: string | null; label: string; description: string | null; amount: string };
type PayorTypeOption = { type: string; label: string; freeText: boolean };
type Match = { id: string; name: string; detail: string };

/** Builds one receipt: payor → dues and manual items in a cart → issue. */
export function ReceiptBuilder({
  payorTypes,
  incomeItems,
  requireBir,
}: {
  payorTypes: PayorTypeOption[];
  incomeItems: Array<{ code: string; label: string }>;
  requireBir: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState(payorTypes[0]?.type ?? "WALK_IN");
  const [walkInName, setWalkInName] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [payor, setPayor] = useState<Match | null>(null);
  const [dues, setDues] = useState<Array<{ type: string; refId: string | null; description: string; amount: string; payable: boolean }>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [income, setIncome] = useState(incomeItems[0]?.code ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"CASH" | "CHECK" | "BANK_TRANSFER">("CASH");
  const [checkNo, setCheckNo] = useState("");
  const [bir, setBir] = useState("");

  const freeText = payorTypes.find((p) => p.type === type)?.freeText ?? false;
  const total = cart.reduce((s, c) => s + (centavos(c.amount) ?? 0n), 0n);

  const add = (item: Omit<CartItem, "key">) => {
    setCart((c) => [...c, { ...item, key: nextKey }]);
    setNextKey((k) => k + 1);
  };

  function search() {
    setError(null);
    startTransition(async () => {
      const r = await searchPayorsAction({ type, q: query });
      if (!r.ok) return setError(r.error);
      setMatches(r.data);
    });
  }

  function choose(m: Match) {
    setPayor(m);
    setMatches([]);
    startTransition(async () => {
      const r = await duesAction({ payor: { type, id: m.id, name: m.name } });
      setDues(r.ok ? r.data : []);
    });
  }

  function addManual() {
    setError(null);
    if (centavos(amount) === null || (centavos(amount) ?? 0n) <= 0n) return setError("Enter an amount more than zero");
    const item = incomeItems.find((i) => i.code === income);
    add({ type: "OTHER_INCOME", refId: income, label: item?.label ?? income, description: description.trim() || null, amount });
    setAmount("");
    setDescription("");
  }

  function issue() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await issueReceiptAction({
          payor: freeText ? { type, id: null, name: walkInName } : { type, id: payor?.id ?? null, name: payor?.name ?? "" },
          mode,
          checkNo: mode === "CHECK" ? checkNo : null,
          birReceiptNo: bir || null,
          items: cart.map((c) => ({ type: c.type, refId: c.refId, amount: c.amount, description: c.description })),
        });
        if (!r.ok) return setError(r.error);
        router.push(`/cashiering/receipts/${r.data.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">New receipt</h2>

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payorType">Payor type</Label>
          <select
            id="payorType"
            className={selectClass}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPayor(null);
              setMatches([]);
              setDues([]);
            }}
          >
            {payorTypes.map((p) => (
              <option key={p.type} value={p.type}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {freeText ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payorName">Payor name</Label>
            <Input id="payorName" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} maxLength={200} />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payorQuery">Search payor</Label>
            <div className="flex gap-2">
              <Input
                id="payorQuery"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                placeholder="Name or number"
              />
              <Button type="button" variant="outline" onClick={search} disabled={pending}>
                Search
              </Button>
            </div>
            {payor ? <p className="text-sm">Payor: <span className="font-medium">{payor.name}</span> <span className="text-muted-foreground">({payor.detail})</span></p> : null}
            {matches.length ? (
              <ul className="divide-y rounded-lg border">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => choose(m)}>
                      <span>{m.name}</span>
                      <span className="text-muted-foreground">{m.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>

      {dues.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">What this payor owes</p>
          {dues.map((d, i) => (
            <div key={`${d.type}-${d.refId}-${i}`} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
              <span>{d.description}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{format(BigInt(d.amount))}</span>
                {d.payable ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => add({ type: d.type, refId: d.refId, label: d.description, description: null, amount: format(BigInt(d.amount)).replace("₱", "").replaceAll(",", "") })}>
                    Add
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[14rem_9rem_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="incomeItem">Income item</Label>
          <select id="incomeItem" className={selectClass} value={income} onChange={(e) => setIncome(e.target.value)}>
            {incomeItems.map((i) => (
              <option key={i.code} value={i.code}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="itemAmount">Amount</Label>
          <Input id="itemAmount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="itemDescription">Description (optional)</Label>
          <Input id="itemDescription" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </div>
        <Button type="button" variant="outline" onClick={addManual}>
          Add item
        </Button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5">Item</th>
            <th className="py-1.5 text-right">Amount</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {cart.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-3 text-center text-muted-foreground">
                No items yet.
              </td>
            </tr>
          ) : null}
          {cart.map((c) => (
            <tr key={c.key} className="border-b">
              <td className="py-1.5">
                {c.label}
                {c.description ? <span className="text-muted-foreground">: {c.description}</span> : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{centavos(c.amount) === null ? c.amount : format(centavos(c.amount) ?? 0n)}</td>
              <td className="py-1.5 text-right">
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${c.label}`} onClick={() => setCart((cs) => cs.filter((x) => x.key !== c.key))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right tabular-nums" data-testid="cart-total">
              {format(total)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="grid gap-3 sm:grid-cols-[12rem_12rem_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mode">Payment mode</Label>
          <select id="mode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </div>
        {mode === "CHECK" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkNo">Check no.</Label>
            <Input id="checkNo" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} maxLength={40} />
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birNo">BIR receipt no.{requireBir ? "" : " (optional)"}</Label>
          <Input id="birNo" value={bir} onChange={(e) => setBir(e.target.value)} maxLength={40} />
        </div>
        <Button type="button" onClick={issue} disabled={pending || cart.length === 0}>
          {pending ? "Issuing…" : "Issue receipt"}
        </Button>
      </div>
      <Err error={error} />
    </section>
  );
}
