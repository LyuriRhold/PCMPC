import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is acting in the current async call chain, when it is not an HTTP request from a
 * signed-in browser: background jobs (cron, billing runs) and tests run code "as" a user.
 * Inside a normal Next.js request this is empty and the session cookie decides.
 */
export type ActorContext = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

const storage = new AsyncLocalStorage<ActorContext>();

export function getActorContext(): ActorContext | undefined {
  return storage.getStore();
}

/** Runs `fn` with `userId` as the acting user (permissions and audit rows use this user). */
export function runAs<T>(userId: string, fn: () => Promise<T>, extra: Omit<ActorContext, "userId"> = {}): Promise<T> {
  return storage.run({ userId, ...extra }, fn);
}
