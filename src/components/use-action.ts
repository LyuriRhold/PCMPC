"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a server action from a client component: tracks pending state, shows its error message,
 * and refreshes the current route on success so server components re-read the data.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run<T>(call: () => Promise<ActionResult<T>>, opts: { success?: string; onSuccess?: (data: T) => void } = {}) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(opts.success ?? null);
        opts.onSuccess?.(result.data);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return { pending, error, done, run };
}
