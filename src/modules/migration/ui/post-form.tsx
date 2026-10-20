"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "@/components/use-action";
import { postMigrationAction } from "../actions";

function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function Done({ done }: { done: string | null }) {
  return done ? <p className="text-sm text-green-700 dark:text-green-400">{done}</p> : null;
}

/** Posts the opening balances once the reconciliation agrees (migration.post). */
export function PostForm({ cutoff, cutoffLabel, canPost, allowed }: { cutoff: string; cutoffLabel: string; canPost: boolean; allowed: boolean }) {
  const { pending, error, done, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          disabled={!canPost || !allowed || pending}
          onClick={() => {
            if (window.confirm(`Post the opening balances as of ${cutoffLabel}? One opening entry is posted, the records are created and the months up to the cut-off are closed. This can't be undone.`)) {
              run(() => postMigrationAction({ cutoffDate: cutoff }), { success: "Opening balances posted." });
            }
          }}
        >
          Post opening balances
        </Button>
      </div>
      {!allowed ? <p className="text-sm text-muted-foreground">The general manager posts the opening balances (migration.post).</p> : null}
      <Err error={error} />
      <Done done={done} />
    </div>
  );
}
