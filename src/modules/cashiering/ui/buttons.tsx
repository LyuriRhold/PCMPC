"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/use-action";
import { approveDvAction, cancelDvAction, cancelReceiptAction, releaseDvAction, verifySessionAction } from "../actions";

function Err({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className="text-xs text-destructive">
      {error}
    </span>
  ) : null;
}

export function VerifySessionButton({ sessionId }: { sessionId: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center justify-end gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => verifySessionAction({ sessionId }))}>
        Verify
      </Button>
      <Err error={error} />
    </span>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      Print
    </Button>
  );
}

export function CancelReceiptForm({ receiptId }: { receiptId: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-2 print:hidden"
      action={(fd) => {
        if (!window.confirm("Cancel this receipt? Its entry is reversed; the number stays used.")) return;
        run(() => cancelReceiptAction({ receiptId, reason: String(fd.get("reason") ?? "") }), { success: "Receipt cancelled." });
      }}
    >
      <Input name="reason" placeholder="Reason for cancelling" required maxLength={300} className="w-72" aria-label="Reason for cancelling" />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Cancel receipt
      </Button>
      <Err error={error} />
      {done ? <span className="text-xs text-green-700">{done}</span> : null}
    </form>
  );
}

export function DvButtons({ dvId, canApprove, canRelease, canCancel }: { dvId: string; canApprove: boolean; canRelease: boolean; canCancel: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? (
        <Button type="button" disabled={pending} onClick={() => run(() => approveDvAction({ dvId }))}>
          Approve
        </Button>
      ) : null}
      {canRelease ? (
        <Button type="button" disabled={pending} onClick={() => run(() => releaseDvAction({ dvId }), { onSuccess: () => router.refresh() })}>
          Release
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Reason for cancelling this DV?");
            if (reason) run(() => cancelDvAction({ dvId, reason }));
          }}
        >
          Cancel DV
        </Button>
      ) : null}
      <Err error={error} />
    </div>
  );
}
