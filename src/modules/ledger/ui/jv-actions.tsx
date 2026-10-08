"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveJvAction, discardJvAction, reverseJvAction } from "../actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  };
  return { router, pending, error, setError, run };
}

function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function ApproveJvButton({ jeId }: { jeId: string }) {
  const { router, pending, error, setError, run } = useRun();
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await approveJvAction({ jeId });
            if (!r.ok) return setError(r.error);
            router.replace(`/accounting/journals/${jeId}?posted=${encodeURIComponent(r.data.jeNo)}`);
            router.refresh();
          })
        }
      >
        {pending ? "Posting…" : "Approve and post"}
      </Button>
      <Err error={error} />
    </div>
  );
}

export function DiscardJvButton({ jeId }: { jeId: string }) {
  const { router, pending, error, setError, run } = useRun();
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Discard this draft? It was never posted, so the books don't change.")) return;
          run(async () => {
            const r = await discardJvAction({ jeId });
            if (!r.ok) return setError(r.error);
            router.push("/accounting/journals");
          });
        }}
      >
        Discard draft
      </Button>
      <Err error={error} />
    </div>
  );
}

export function ReverseJvForm({ jeId, today }: { jeId: string; today: string }) {
  const { router, pending, error, setError, run } = useRun();
  return (
    <form
      className="grid max-w-2xl gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
      action={(fd) =>
        run(async () => {
          if (!window.confirm("Post a reversing entry? The original stays in the books, marked REVERSED.")) return;
          const r = await reverseJvAction({ jeId, date: String(fd.get("date") ?? ""), reason: String(fd.get("reason") ?? "") });
          if (!r.ok) return setError(r.error);
          router.refresh();
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rev-date">Reversal date</Label>
        <Input id="rev-date" name="date" type="date" defaultValue={today} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rev-reason">Reason</Label>
        <Input id="rev-reason" name="reason" required maxLength={300} />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        Reverse entry
      </Button>
      <div className="sm:col-span-3">
        <Err error={error} />
      </div>
    </form>
  );
}
