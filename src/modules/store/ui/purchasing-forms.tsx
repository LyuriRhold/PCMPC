"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { format, parse } from "@/lib/money";
import { selectClass } from "@/modules/members/ui/member-form";
import { approvePoAction, cancelPoAction, createPoAction, paySupplierAction, receiveAction } from "../actions";
import { Done, Err } from "./store-forms";

type Option = { id: string; label: string };
type Line = { key: number; productId: string; qty: string; unitCost: string };

/** The total of the lines, or null while an amount isn't a valid peso amount yet. */
function totalOf(lines: Array<{ qty: string; unitCost: string }>): bigint | null {
  let total = 0n;
  for (const l of lines) {
    const q = l.qty.replace(/,/g, "").trim();
    if (!/^\d+$/.test(q)) return null;
    try {
      total += BigInt(q) * parse(l.unitCost);
    } catch {
      return null;
    }
  }
  return total;
}

const qtyOf = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  return /^\d+$/.test(t) ? Number(t) : -1;
};

function LineRows({ lines, setLines, products, fixedProducts }: { lines: Line[]; setLines: (l: Line[]) => void; products: Option[]; fixedProducts?: boolean }) {
  const set = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => (
        <div key={l.key} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <Label htmlFor={`product-${l.key}`}>Product, line {i + 1}</Label>
            <select id={`product-${l.key}`} className={selectClass} value={l.productId} disabled={fixedProducts} onChange={(e) => set(l.key, { productId: e.target.value })}>
              <option value="">Choose…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`qty-${l.key}`}>Quantity, line {i + 1}</Label>
            <Input id={`qty-${l.key}`} inputMode="numeric" className="w-24" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`cost-${l.key}`}>Unit cost, line {i + 1}</Label>
            <Input id={`cost-${l.key}`} inputMode="decimal" className="w-32" value={l.unitCost} onChange={(e) => set(l.key, { unitCost: e.target.value })} />
          </div>
          {!fixedProducts && lines.length > 1 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
              Remove
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Store clerk: a purchase order. */
export function PoForm({ suppliers, products }: { suppliers: Option[]; products: Option[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: "", qty: "", unitCost: "" }]);
  const total = totalOf(lines);
  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createPoAction({ supplierId, remarks: remarks || null, lines: lines.map((l) => ({ productId: l.productId, qty: qtyOf(l.qty), unitCost: l.unitCost })) });
      if (!r.ok) return setError(r.error);
      router.push(`/store/purchasing/orders/${r.data.id}`);
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-64 flex-col gap-1.5">
          <Label htmlFor="supplier">Supplier</Label>
          <select id="supplier" className={selectClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor="remarks">Remarks (optional)</Label>
          <Input id="remarks" maxLength={300} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
      <LineRows lines={lines} setLines={setLines} products={products} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => setLines([...lines, { key: Math.max(...lines.map((l) => l.key)) + 1, productId: "", qty: "", unitCost: "" }])}>
          Add a line
        </Button>
        <span className="text-sm text-muted-foreground">Total {total === null ? "—" : format(total)}</span>
      </div>
      <div>
        <Button type="button" disabled={pending} onClick={submit}>
          Save purchase order
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Manager: approves or cancels a purchase order. */
export function PoActions({ poId, canApprove, canCancel }: { poId: string; canApprove: boolean; canCancel: boolean }) {
  const approve = useAction();
  const cancel = useAction();
  return (
    <div className="flex flex-col gap-3">
      {canApprove ? (
        <div className="flex flex-col gap-1">
          <div>
            <Button type="button" disabled={approve.pending} onClick={() => approve.run(() => approvePoAction({ poId }), { success: "Approved." })}>
              Approve purchase order
            </Button>
          </div>
          <Err error={approve.error} />
        </div>
      ) : null}
      {canCancel ? (
        <form className="flex flex-wrap items-end gap-2" action={(fd) => cancel.run(() => cancelPoAction({ poId, reason: String(fd.get("poCancelReason") ?? "") }), { success: "Cancelled." })}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poCancelReason">Reason for cancelling</Label>
            <Input id="poCancelReason" name="poCancelReason" maxLength={300} className="w-64" />
          </div>
          <Button type="submit" variant="destructive" disabled={cancel.pending}>
            Cancel purchase order
          </Button>
          <div className="w-full">
            <Err error={cancel.error} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

export type RrPo = { id: string; poNo: string; supplierId: string; supplierName: string; lines: Array<{ poLineId: string; productId: string; label: string; remaining: number; unitCost: string }> };

/** Store clerk: a receiving report, against an approved PO or for a delivery without one. */
export function RrForm({ suppliers, products, po }: { suppliers: Option[]; products: Option[]; po: RrPo | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? "");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [payment, setPayment] = useState<"ON_ACCOUNT" | "CASH">("ON_ACCOUNT");
  const poLines = po?.lines.filter((l) => l.remaining > 0) ?? [];
  const [lines, setLines] = useState<Line[]>(
    po ? poLines.map((l, i) => ({ key: i + 1, productId: l.productId, qty: String(l.remaining), unitCost: l.unitCost })) : [{ key: 1, productId: "", qty: "", unitCost: "" }],
  );
  const total = totalOf(lines.filter((l) => qtyOf(l.qty) !== 0));
  function submit() {
    setError(null);
    const chosen = lines
      .map((l, i) => ({ l, poLineId: po ? (poLines[i]?.poLineId ?? null) : null }))
      .filter(({ l }) => !po || qtyOf(l.qty) !== 0)
      .map(({ l, poLineId }) => ({ productId: l.productId, poLineId, qty: qtyOf(l.qty), unitCost: l.unitCost }));
    startTransition(async () => {
      const r = await receiveAction({ supplierId, poId: po?.id ?? null, invoiceNo: invoiceNo || null, payment, lines: chosen });
      if (!r.ok) return setError(r.error);
      router.push(`/store/purchasing/receiving/${r.data.id}`);
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-64 flex-col gap-1.5">
          <Label htmlFor="rrSupplier">Supplier</Label>
          <select id="rrSupplier" className={selectClass} value={supplierId} disabled={!!po} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {(po ? [{ id: po.supplierId, label: po.supplierName }] : suppliers).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoiceNo">Supplier invoice no.</Label>
          <Input id="invoiceNo" maxLength={60} className="w-48" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment">Payment</Label>
          <select id="payment" className={selectClass} value={payment} onChange={(e) => setPayment(e.target.value as "ON_ACCOUNT" | "CASH")}>
            <option value="ON_ACCOUNT">On account (pay later)</option>
            <option value="CASH">Cash on delivery (the teller pays it by DV)</option>
          </select>
        </div>
      </div>
      {po ? <p className="text-sm text-muted-foreground">Against {po.poNo}: each line starts with what is still to come. Set a line to 0 if it didn&apos;t arrive.</p> : null}
      <LineRows lines={lines} setLines={setLines} products={po ? poLines.map((l) => ({ id: l.productId, label: l.label })) : products} fixedProducts={!!po} />
      <div className="flex flex-wrap items-center gap-3">
        {po ? null : (
          <Button type="button" variant="outline" onClick={() => setLines([...lines, { key: Math.max(...lines.map((l) => l.key)) + 1, productId: "", qty: "", unitCost: "" }])}>
            Add a line
          </Button>
        )}
        <span className="text-sm text-muted-foreground">Total {total === null ? "—" : format(total)}</span>
      </div>
      <div>
        <Button type="button" disabled={pending} onClick={submit}>
          Post receiving report
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** Bookkeeper: a supplier payment voucher. */
export function PaySupplierForm({ suppliers }: { suppliers: Array<{ id: string; label: string }> }) {
  const { pending, error, done, run } = useAction();
  const [mode, setMode] = useState<"CASH" | "CHECK">("CHECK");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(
          () =>
            paySupplierAction({
              supplierId: String(fd.get("paySupplier") ?? ""),
              amount: String(fd.get("payAmount") ?? ""),
              mode,
              checkNo: mode === "CHECK" ? String(fd.get("payCheck") ?? "") || null : null,
              particulars: String(fd.get("payParticulars") ?? "") || null,
            }),
          { success: "Voucher prepared; the manager approves it, then the teller releases it." },
        )
      }
    >
      <div className="flex min-w-64 flex-col gap-1.5">
        <Label htmlFor="paySupplier">Pay supplier</Label>
        <select id="paySupplier" name="paySupplier" className={selectClass}>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payAmount">Amount (₱)</Label>
        <Input id="payAmount" name="payAmount" inputMode="decimal" className="w-36" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payMode">Paid by</Label>
        <select id="payMode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "CASH" | "CHECK")}>
          <option value="CHECK">Check</option>
          <option value="CASH">Cash from a teller&apos;s drawer</option>
        </select>
      </div>
      {mode === "CHECK" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payCheck">Check no.</Label>
          <Input id="payCheck" name="payCheck" maxLength={40} className="w-36" />
        </div>
      ) : null}
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor="payParticulars">Particulars (optional)</Label>
        <Input id="payParticulars" name="payParticulars" maxLength={200} placeholder="e.g. invoices 1201–1210" />
      </div>
      <Button type="submit" disabled={pending}>
        Prepare voucher
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
