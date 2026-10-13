"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { approveCountAction, createCountAction, enterCountAction, returnCountAction, submitCountAction } from "../actions";
import { Done, Err } from "./store-forms";

/** Store clerk: starts a count sheet (a category's products, or all active products). */
export function NewCountForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const r = await createCountAction({ productIds: [], categoryId: String(fd.get("countCategory") ?? "") || null, remarks: String(fd.get("countRemarks") ?? "") || null });
          if (!r.ok) return setError(r.error);
          router.push(`/store/inventory/counts/${r.data.id}`);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="countCategory">Products to count</Label>
        <select id="countCategory" name="countCategory" className={selectClass}>
          <option value="">All active products</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="countRemarks">Remarks (optional)</Label>
        <Input id="countRemarks" name="countRemarks" maxLength={300} placeholder="e.g. month-end count, October" />
      </div>
      <Button type="submit" disabled={pending}>
        Start a count
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

type SheetLine = { productId: string; sku: string; name: string; unit: string; countedQty: number | null };

/** Store clerk: enters what was counted (blind: the system quantities are shown after submission). */
export function CountSheetForm({ countId, lines }: { countId: string; lines: SheetLine[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.productId, l.countedQty === null ? "" : String(l.countedQty)])));
  const parsed = () =>
    lines.map((l) => {
      const t = (values[l.productId] ?? "").replace(/,/g, "").trim();
      return { productId: l.productId, countedQty: t === "" ? null : /^\d+$/.test(t) ? Number(t) : -1 };
    });
  function save(submit: boolean) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await enterCountAction({ countId, lines: parsed() });
      if (!r.ok) return setError(r.error);
      if (submit) {
        const s = await submitCountAction({ countId });
        if (!s.ok) return setError(s.error);
      } else setDone("Counts saved.");
      router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {lines.map((l) => (
          <div key={l.productId} className="flex items-center justify-between gap-3 border-b py-1">
            <Label htmlFor={`counted-${l.productId}`} className="font-normal">
              <span className="font-mono text-xs">{l.sku}</span> {l.name}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`counted-${l.productId}`}
                aria-label={`Counted, ${l.sku}`}
                inputMode="numeric"
                className="w-24 text-right"
                value={values[l.productId] ?? ""}
                onChange={(e) => setValues({ ...values, [l.productId]: e.target.value })}
              />
              <span className="w-12 text-xs text-muted-foreground">{l.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
          Save counts
        </Button>
        <Button type="button" disabled={pending} onClick={() => save(true)}>
          Submit for approval
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}

/** Manager: sends a submitted count back to the clerk (e.g. a miscount); it is a draft again. */
export function ReturnCountForm({ countId }: { countId: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" action={(fd) => run(() => returnCountAction({ countId, reason: String(fd.get("returnReason") ?? "") }))}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="returnReason">Reason for sending it back</Label>
        <Input id="returnReason" name="returnReason" maxLength={300} className="w-72" placeholder="e.g. recount the rice, 130 looks wrong" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Return to the clerk
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Manager (not the preparer): approves a submitted count; the variances are posted. */
export function ApproveCountButton({ countId }: { countId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Approve the count? Its variances are posted to stock and the books.")) return;
            run(() => approveCountAction({ countId }));
          }}
        >
          Approve and post the variances
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}
