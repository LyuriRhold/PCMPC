"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, parse } from "@/lib/money";
import { completeSaleAction, findMembersAction, findProductAction, voidSaleAction, type PosMember, type ScannedProduct } from "../pos-actions";
import { Err } from "./store-forms";

type Line = ScannedProduct & { qty: number };

const qtyOf = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

/**
 * The POS terminal: the barcode/SKU field keeps the focus; Enter adds the item (the "next
 * quantity" field sets how many, e.g. 12 for a dozen). Prices are shown for the cashier; the server
 * prices the sale again from the item master.
 */
export function PosTerminal() {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nextQty, setNextQty] = useState("1");
  const [lines, setLines] = useState<Line[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [found, setFound] = useState<PosMember[] | null>(null);
  const [member, setMember] = useState<PosMember | null>(null);
  const [payment, setPayment] = useState<"CASH" | "CHARGE">("CASH");
  const [tendered, setTendered] = useState("");
  const [done, setDone] = useState<{ id: string; saleNo: string; total: string; change: string | null } | null>(null);
  const [voiding, setVoiding] = useState(false);

  const total = lines.reduce((s, l) => s + BigInt(l.price) * BigInt(l.qty), 0n);
  let tenderedAmount: bigint | null = null;
  try {
    tenderedAmount = tendered.trim() ? parse(tendered) : null;
  } catch {
    tenderedAmount = null;
  }
  const change = tenderedAmount !== null ? tenderedAmount - total : null;
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  function scan() {
    const c = code.trim();
    if (!c) return;
    const add = qtyOf(nextQty);
    setError(null);
    startTransition(async () => {
      const r = await findProductAction({ code: c });
      if (!r.ok) {
        setError(r.error);
      } else {
        const n = Number.isNaN(add) || add <= 0 ? 1 : add;
        setLines((ls) => (ls.some((l) => l.id === r.data.id) ? ls.map((l) => (l.id === r.data.id ? { ...l, qty: l.qty + n } : l)) : [...ls, { ...r.data, qty: n }]));
        setDone(null);
      }
      setCode("");
      setNextQty("1");
      focusScan();
    });
  }

  function setQty(id: string, qty: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty } : l)).filter((l) => l.qty > 0));
  }

  function searchMember() {
    if (!memberQuery.trim()) return;
    startTransition(async () => {
      const r = await findMembersAction({ q: memberQuery.trim() });
      if (!r.ok) setError(r.error);
      else setFound(r.data);
    });
  }

  function reset() {
    setLines([]);
    setMember(null);
    setFound(null);
    setMemberQuery("");
    setPayment("CASH");
    setTendered("");
    setVoiding(false);
    focusScan();
  }

  function complete() {
    setError(null);
    startTransition(async () => {
      const r = await completeSaleAction({
        memberId: member?.id ?? null,
        payment,
        lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
        tendered: payment === "CASH" ? tendered : null,
        birInvoiceNo: null,
      });
      if (!r.ok) return setError(r.error);
      setDone({ id: r.data.id, saleNo: r.data.saleNo, total: r.data.total, change: r.data.change });
      reset();
      router.refresh();
    });
  }

  function voidIt(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await voidSaleAction({
        memberId: member?.id ?? null,
        payment,
        lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
        reason: String(fd.get("voidReason") ?? ""),
        supervisor: { username: String(fd.get("supUser") ?? ""), password: String(fd.get("supPass") ?? "") },
      });
      if (!r.ok) return setError(r.error);
      setDone(null);
      reset();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <section className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            scan();
          }}
        >
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="nextQty">Next quantity</Label>
            <Input id="nextQty" inputMode="numeric" className="h-12 text-lg" value={nextQty} onChange={(e) => setNextQty(e.target.value)} onFocus={(e) => e.target.select()} />
          </div>
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <Label htmlFor="scan">Barcode or SKU</Label>
            <Input id="scan" ref={scanRef} autoFocus autoComplete="off" className="h-12 text-lg" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" className="h-12 px-6" disabled={pending}>
            Add
          </Button>
        </form>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          Quantity shortcuts:
          {[2, 3, 6, 12].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNextQty(String(n));
                focusScan();
              }}
            >
              ×{n}
            </Button>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-center">Quantity</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  Scan an item to start a sale.
                </td>
              </tr>
            ) : null}
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{l.sku}</span>
                  {l.qty > l.onHand ? <span className="ml-2 text-xs text-destructive">only {l.onHand} in stock</span> : null}
                </td>
                <td className="py-2 text-right tabular-nums">{format(BigInt(l.price))}</td>
                <td className="py-2">
                  <div className="flex items-center justify-center gap-1">
                    <Button type="button" size="sm" variant="outline" aria-label={`One less ${l.sku}`} onClick={() => setQty(l.id, l.qty - 1)}>
                      −
                    </Button>
                    <Input
                      aria-label={`Quantity, ${l.sku}`}
                      inputMode="numeric"
                      className="h-9 w-16 text-center"
                      value={String(l.qty)}
                      onChange={(e) => {
                        const n = qtyOf(e.target.value);
                        if (!Number.isNaN(n)) setQty(l.id, n);
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" aria-label={`One more ${l.sku}`} onClick={() => setQty(l.id, l.qty + 1)}>
                      +
                    </Button>
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{format(BigInt(l.price) * BigInt(l.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-3xl font-semibold tabular-nums" data-testid="pos-total">
            {format(total)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="memberQuery">Member (optional)</Label>
          {member ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span>
                {member.name} <span className="font-mono text-xs text-muted-foreground">{member.memberNo}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => (setMember(null), setPayment("CASH"))}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="memberQuery"
                placeholder="Member no. or name"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchMember();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={searchMember} disabled={pending}>
                Find
              </Button>
            </div>
          )}
          {!member && found ? (
            <ul className="flex flex-col gap-1">
              {found.length === 0 ? <li className="text-sm text-muted-foreground">No ACTIVE member found.</li> : null}
              {found.map((m) => (
                <li key={m.id}>
                  <Button type="button" variant="ghost" size="sm" onClick={() => (setMember(m), setFound(null), focusScan())}>
                    {m.memberNo} · {m.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button type="button" className="h-11 flex-1" variant={payment === "CASH" ? "default" : "outline"} onClick={() => setPayment("CASH")}>
            Cash
          </Button>
          <Button type="button" className="h-11 flex-1" variant={payment === "CHARGE" ? "default" : "outline"} disabled={!member} onClick={() => setPayment("CHARGE")}>
            Charge to member
          </Button>
        </div>

        {payment === "CASH" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tendered">Amount tendered (₱)</Label>
            <Input id="tendered" inputMode="decimal" className="h-12 text-right text-lg" value={tendered} onChange={(e) => setTendered(e.target.value)} />
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setTendered(format(total).replace("₱", ""))}>
                Exact
              </Button>
              {[100, 200, 500, 1000].map((n) => (
                <Button key={n} type="button" size="sm" variant="outline" onClick={() => setTendered(`${n}.00`)}>
                  ₱{n.toLocaleString("en-PH")}
                </Button>
              ))}
            </div>
            <p className="text-sm">
              Change: <span className="font-semibold tabular-nums">{change !== null && change >= 0n ? format(change) : "—"}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Charged to {member?.name}&apos;s store account (within their credit limit).</p>
        )}

        <Button type="button" className="h-14 text-lg" disabled={pending || lines.length === 0} onClick={complete}>
          Complete sale
        </Button>
        <Err error={error} />

        {done ? (
          <div className="rounded-md border border-green-600/40 bg-green-50 p-3 text-sm dark:bg-green-950/30">
            <p className="font-medium">
              Sale {done.saleNo} · {done.total}
            </p>
            {done.change !== null ? (
              <p className="text-lg">
                Change{" "}
                <span className="font-semibold tabular-nums" data-testid="pos-change">
                  {done.change}
                </span>
              </p>
            ) : (
              <p>Charged to the member&apos;s account.</p>
            )}
            <Link href={`/store/pos/sales/${done.id}`} className="underline underline-offset-4">
              Print the slip
            </Link>
          </div>
        ) : null}

        {lines.length > 0 ? (
          voiding ? (
            <form action={voidIt} className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Void this sale (a supervisor approves)</p>
              <Input name="voidReason" aria-label="Reason for the void" placeholder="Reason" maxLength={300} />
              <Input name="supUser" aria-label="Supervisor username" placeholder="Supervisor username" autoComplete="off" />
              <Input name="supPass" aria-label="Supervisor password" placeholder="Supervisor password" type="password" autoComplete="off" />
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={pending}>
                  Void sale
                </Button>
                <Button type="button" variant="ghost" onClick={() => setVoiding(false)}>
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" onClick={() => setVoiding(true)}>
              Void sale…
            </Button>
          )
        ) : null}
      </aside>
    </div>
  );
}
