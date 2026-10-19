"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { viewAsRoleAction } from "@/modules/auth/session-actions";

/** The super admin's role picker: view the system as any role, or as the administrator. */
export function ViewAsSelect({ current, roles }: { current: string; roles: Array<{ code: string; name: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="hidden items-center gap-1 text-sm lg:flex">
      <span className="text-muted-foreground">View as</span>
      <select
        aria-label="View as role"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const role = e.target.value;
          setError(null);
          start(async () => {
            const r = await viewAsRoleAction({ role });
            if (!r.ok) return setError(r.error);
            router.push("/");
            router.refresh();
          });
        }}
      >
        {roles.map((r) => (
          <option key={r.code} value={r.code}>
            {r.code === "ADMIN" ? "Administrator (all)" : r.name}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** Shown on every page while the super admin views the system as another role. */
export function ViewAsBanner({ roleName }: { roleName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <span>
        You are viewing the system as <strong>{roleName}</strong>: only that role&apos;s screens and actions.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await viewAsRoleAction({ role: null });
            router.push("/");
            router.refresh();
          })
        }
      >
        Back to Administrator
      </Button>
    </div>
  );
}
