import { ZodError } from "zod";

/**
 * What a server action returns. Permission failures are NOT returned: `requirePermission()`
 * throws, so a forbidden call can never look like a successful one.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Turns expected business/validation errors into a failed result; rethrows anything else. */
export function failFrom(e: unknown, expected: Array<new (...args: never[]) => Error>): ActionResult<never> {
  if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  if (expected.some((cls) => e instanceof cls)) return { ok: false, error: (e as Error).message };
  throw e;
}
