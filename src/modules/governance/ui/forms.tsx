"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import { selectClass } from "@/modules/members/ui/member-form";
import { addOfficerAction, addTrainingAction, endOfficerTermAction } from "../actions";

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

/** Records an officer or committee member and their term. */
export function OfficerForm({ committees }: { committees: Array<{ code: string; name: string }> }) {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      action={(fd) =>
        run(
          () =>
            addOfficerAction({
              memberNo: String(fd.get("memberNo") ?? ""),
              position: String(fd.get("position") ?? ""),
              committee: String(fd.get("committee") ?? ""),
              termStart: String(fd.get("termStart") ?? ""),
              termEnd: String(fd.get("termEnd") ?? "") || null,
              electedAtGa: String(fd.get("electedAtGa") ?? "") || null,
            }),
          { success: "Officer added." },
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="memberNo">Member no.</Label>
        <Input id="memberNo" name="memberNo" placeholder="M-000001" maxLength={20} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="committee">Board or committee</Label>
        <select id="committee" name="committee" className={selectClass} defaultValue="BOARD">
          {committees.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="position">Position</Label>
        <Input id="position" name="position" placeholder="Chairperson" maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="termStart">Term starts</Label>
        <Input id="termStart" name="termStart" type="date" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="termEnd">Term ends</Label>
        <Input id="termEnd" name="termEnd" type="date" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="electedAtGa">Elected at the GA of</Label>
        <Input id="electedAtGa" name="electedAtGa" type="date" />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Add officer
        </Button>
      </div>
      <div className="sm:col-span-3">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}

/** Ends an officer's term. */
export function EndTermForm({ officerId, label }: { officerId: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-center gap-1" action={(fd) => run(() => endOfficerTermAction({ officerId, termEnd: String(fd.get("termEnd") ?? "") }))}>
      <Input name="termEnd" type="date" aria-label={`${label}: term ends`} className="h-7 w-36" />
      <Button type="submit" size="sm" variant="outline" className="h-7" disabled={pending}>
        End term
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Records a training and its attendees (member nos.). */
export function TrainingForm() {
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      action={(fd) =>
        run(
          () =>
            addTrainingAction({
              title: String(fd.get("title") ?? ""),
              provider: String(fd.get("provider") ?? ""),
              heldOn: String(fd.get("heldOn") ?? ""),
              hours: String(fd.get("hours") ?? ""),
              memberNos: String(fd.get("memberNos") ?? ""),
            }),
          { success: "Training recorded." },
        )
      }
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="title">Training</Label>
        <Input id="title" name="title" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="provider">Given by</Label>
        <Input id="provider" name="provider" maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="heldOn">Date</Label>
        <Input id="heldOn" name="heldOn" type="date" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hours">Hours</Label>
        <Input id="hours" name="hours" inputMode="decimal" />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-3">
        <Label htmlFor="memberNos">Attendees (member nos., separated by commas)</Label>
        <Input id="memberNos" name="memberNos" placeholder="M-000001, M-000002" />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Record training
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
