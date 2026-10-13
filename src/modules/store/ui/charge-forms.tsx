"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/use-action";
import { setChargeLimitAction } from "../pos-actions";
import { Err } from "./store-forms";

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
