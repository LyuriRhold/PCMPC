"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/use-action";
import { Label } from "@/components/ui/label";
import { setChargeLimitAction, setChargeLimitByNoAction } from "../pos-actions";
import { Done, Err } from "./store-forms";

/** Manager: a member's own store credit limit. */
export function ChargeLimitForm({ memberId, limit, label }: { memberId: string; limit: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-center justify-end gap-2" action={(fd) => run(() => setChargeLimitAction({ memberId, limit: String(fd.get("limit") ?? "") }))}>
      <Input name="limit" aria-label={`Credit limit of ${label}`} defaultValue={limit} inputMode="decimal" className="w-28 text-right" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Set
      </Button>
      <Err error={error} />
    </form>
  );
}

/** Manager: sets the credit limit of any member by member no. (e.g. ₱0.00 before their first charge). */
export function ChargeLimitByNoForm() {
  const { pending, error, done, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg border p-3" action={(fd) => run(() => setChargeLimitByNoAction({ memberNo: String(fd.get("limitMemberNo") ?? ""), limit: String(fd.get("limitAmount") ?? "") }), { success: "Credit limit set." })}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="limitMemberNo">Member no.</Label>
        <Input id="limitMemberNo" name="limitMemberNo" placeholder="M-000001" className="w-36" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="limitAmount">Credit limit (₱)</Label>
        <Input id="limitAmount" name="limitAmount" inputMode="decimal" className="w-32 text-right" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Set limit
      </Button>
      <div className="w-full">
        <Err error={error} />
        <Done done={done} />
      </div>
    </form>
  );
}
