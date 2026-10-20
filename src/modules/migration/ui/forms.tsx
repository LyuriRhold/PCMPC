"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { rollbackBatchAction, stageBatchAction, uploadBatchAction } from "../actions";

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

/** Uploads a filled template for the cut-off and shows the dry-run result. */
export function UploadForm({ entities, cutoff, cutoffFixed }: { entities: Array<{ value: string; title: string }>; cutoff: string; cutoffFixed: boolean }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      action={(fd) =>
        run(() => uploadBatchAction(fd), {
          success: "Uploaded and checked.",
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entity">Records</Label>
        <select id="entity" name="entity" className={selectClass} defaultValue={entities[0]?.value}>
          {entities.map((e) => (
            <option key={e.value} value={e.value}>
              {e.title}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cutoffDate">Cut-off date</Label>
        <Input id="cutoffDate" name="cutoffDate" type="date" defaultValue={cutoff} readOnly={cutoffFixed} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="file">Excel file</Label>
        <Input id="file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={pending}>
          Upload and check
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Stage / roll back one file. */
export function BatchButtons({ batchId, fileName, canStage, canRollBack }: { batchId: string; fileName: string; canStage: boolean; canRollBack: boolean }) {
  const stage = useAction();
  const rollback = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canStage ? (
          <Button
            type="button"
            size="sm"
            aria-label={`Stage ${fileName}`}
            disabled={stage.pending}
            onClick={() =>
              stage.run(() => stageBatchAction({ batchId }), {
                success: "Staged.",
              })
            }
          >
            Stage
          </Button>
        ) : null}
        {canRollBack ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Roll back ${fileName}`}
            disabled={rollback.pending}
            onClick={() => {
              if (window.confirm(`Roll back ${fileName}? Its staged rows are removed (the file and its error list are kept).`)) {
                rollback.run(() => rollbackBatchAction({ batchId }), { success: "File rolled back." });
              }
            }}
          >
            Roll back
          </Button>
        ) : null}
      </div>
      <Err error={stage.error ?? rollback.error} />
      <Done done={stage.done ?? rollback.done} />
    </div>
  );
}
