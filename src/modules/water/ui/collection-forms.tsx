"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { addProductionReadingAction, cancelNoticeAction, disconnectAction, issueNoticeAction, reconnectAction, runDailyJobsAction } from "../collection-actions";

function Err({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className="text-xs text-destructive">
      {error}
    </span>
  ) : null;
}

export function IssueNoticeButton({ accountId, accountNo }: { accountId: string; accountNo: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" size="sm" aria-label={`Issue notice for ${accountNo}`} disabled={pending} onClick={() => run(() => issueNoticeAction({ accountId }))}>
        Issue notice
      </Button>
      <Err error={error} />
    </span>
  );
}

/** Disconnect or reconnect order: the meter reading at the time, then the action. */
export function OrderForm({ disconnectionId, accountNo, kind }: { disconnectionId: string; accountNo: string; kind: "disconnect" | "reconnect" }) {
  const { pending, error, run } = useAction();
  const label = kind === "disconnect" ? "Disconnect" : "Reconnect";
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      action={(fd) => {
        const reading = Number(String(fd.get("reading") ?? "").trim());
        run(() => (kind === "disconnect" ? disconnectAction({ disconnectionId, reading }) : reconnectAction({ disconnectionId, reading })));
      }}
    >
      <Input name="reading" inputMode="numeric" required className="w-28" aria-label={`${label} reading for ${accountNo}`} placeholder="Reading" />
      <Button type="submit" size="sm" variant={kind === "disconnect" ? "destructive" : "default"} aria-label={`${label} ${accountNo}`} disabled={pending}>
        {label}
      </Button>
      <Err error={error} />
    </form>
  );
}

export function CancelNoticeButton({ disconnectionId, noticeNo }: { disconnectionId: string; noticeNo: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Cancel notice ${noticeNo}`}
        disabled={pending}
        onClick={() => {
          const reason = window.prompt(`Why cancel notice ${noticeNo}?`);
          if (reason) run(() => cancelNoticeAction({ disconnectionId, reason }));
        }}
      >
        Cancel notice
      </Button>
      <Err error={error} />
    </span>
  );
}

export function RunJobsButton() {
  const { pending, error, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => runDailyJobsAction(), { success: "Today's jobs ran." })}>
        Run today&apos;s daily jobs (penalties)
      </Button>
      <Err error={error} />
    </span>
  );
}

export function ProductionReadingForm({ today }: { today: string }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(fd) =>
        run(() => addProductionReadingAction({ source: String(fd.get("source") ?? ""), readingDate: String(fd.get("readingDate") ?? ""), reading: Number(String(fd.get("prodReading") ?? "").trim()) }), {
          success: "Production reading saved.",
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source">Source meter</Label>
        <Input id="source" name="source" required maxLength={60} placeholder="e.g. WELL-1" className="w-40" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="readingDate">Reading date</Label>
        <Input id="readingDate" name="readingDate" type="date" required defaultValue={today} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prodReading">Reading (m³)</Label>
        <Input id="prodReading" name="prodReading" inputMode="numeric" required className="w-36" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save production reading
      </Button>
      <div className="w-full">
        <Err error={error} />
        {done ? <span className="text-xs text-green-700 dark:text-green-400">{done}</span> : null}
      </div>
    </form>
  );
}
