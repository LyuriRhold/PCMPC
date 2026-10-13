"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { closeShiftAction, openShiftAction, returnSaleAction, verifyShiftAction } from "../pos-actions";
import { Done, Err } from "./store-forms";

/** Cashier: opens today's shift with the change fund in the drawer. */
export function OpenShiftForm() {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border p-4" action={(fd) => run(() => openShiftAction({ openingFund: String(fd.get("openingFund") ?? "") }))}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="openingFund">Opening fund (₱)</Label>
        <Input id="openingFund" name="openingFund" inputMode="decimal" className="h-11 w-40 text-right" defaultValue="0.00" />
      </div>
      <Button type="submit" className="h-11" disabled={pending}>
        Open shift
      </Button>
      <div className="w-full">
        <Err error={error} />
      </div>
    </form>
  );
}

/** Cashier: closes the shift with the cash counted in the drawer. */
export function CloseShiftForm({ shiftId }: { shiftId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) => {
        if (!window.confirm("Close the shift? No more sales can be made on it.")) return;
        run(() => closeShiftAction({ shiftId, countedCash: String(fd.get("countedCash") ?? "") }), { success: "Shift closed." });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="countedCash">Cash counted (₱)</Label>
        <Input id="countedCash" name="countedCash" inputMode="decimal" className="w-40 text-right" />
      </div>
      <Button type="submit" disabled={pending}>
        Close shift
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Manager (not the cashier): verifies a closed shift; a variance is posted to Cash Short/Over. */
export function VerifyShiftButton({ shiftId }: { shiftId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button type="button" disabled={pending} onClick={() => run(() => verifyShiftAction({ shiftId }))}>
          Verify the shift
        </Button>
      </div>
      <Err error={error} />
    </div>
  );
}

type ReturnLine = { id: string; label: string; left: number };

/** Cashier: goods returned from a sale; cash from the drawer, or back to the member's account for a charge sale. */
export function ReturnForm({ saleId, lines, charge }: { saleId: string; lines: ReturnLine[]; charge: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      action={(fd) => {
        setError(null);
        setDone(null);
        const chosen = lines
          .map((l) => {
            const t = String(fd.get(`ret-${l.id}`) ?? "").trim();
            return { saleLineId: l.id, qty: t === "" ? 0 : /^\d+$/.test(t) ? Number(t) : -1 };
          })
          .filter((l) => l.qty !== 0);
        startTransition(async () => {
          const r = await returnSaleAction({ saleId, lines: chosen, refundMode: String(fd.get("refundMode") ?? "CASH") === "AR" ? "AR" : "CASH", reason: String(fd.get("returnReason") ?? "") });
          if (!r.ok) return setError(r.error);
          setDone(`Return ${r.data.returnNo} recorded.`);
          router.refresh();
        });
      }}
    >
      <h2 className="text-sm font-semibold">Return goods</h2>
      {lines.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
          <Label htmlFor={`ret-${l.id}`} className="font-normal">
            {l.label} <span className="text-muted-foreground">(up to {l.left})</span>
          </Label>
          <Input id={`ret-${l.id}`} name={`ret-${l.id}`} aria-label={`Return, ${l.label}`} inputMode="numeric" className="w-20 text-right" />
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refundMode">Refund</Label>
          <select id="refundMode" name="refundMode" className={selectClass} defaultValue={charge ? "AR" : "CASH"}>
            <option value="CASH">Cash from my drawer</option>
            {charge ? <option value="AR">Credit the member&apos;s store account</option> : null}
          </select>
        </div>
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="returnReason">Reason</Label>
          <Input id="returnReason" name="returnReason" maxLength={300} />
        </div>
        <Button type="submit" disabled={pending}>
          Record the return
        </Button>
      </div>
      <Err error={error} />
      <Done done={done} />
    </form>
  );
}
