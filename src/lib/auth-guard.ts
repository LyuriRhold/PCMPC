import { cache } from "react";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getActorContext, runAs } from "@/lib/request-context";
import type { Permission } from "@/modules/auth/permissions";
import { getUser, permissionsOfRole } from "@/modules/auth/service";

export { runAs };

/** No signed-in (or active) user. */
export class UnauthenticatedError extends Error {
  override name = "UnauthenticatedError";
  constructor() {
    super("Not signed in");
  }
}

/** The signed-in user lacks the permission. Always enforced server-side. */
export class ForbiddenError extends Error {
  override name = "ForbiddenError";
  constructor(readonly permission: string) {
    super(`Forbidden: ${permission} is required`);
  }
}

/** Segregation of duties was violated (the preparer tried to approve). */
export class SodError extends Error {
  override name = "SodError";
}

export type CurrentUser = {
  id: string;
  username: string;
  name: string;
  roleCode: string;
  permissions: ReadonlySet<string>;
};

async function sessionUserId(): Promise<string | null> {
  const actor = getActorContext();
  if (actor) return actor.userId;
  let requestHeaders: Headers;
  try {
    const { headers } = await import("next/headers");
    requestHeaders = await headers();
  } catch {
    return null; // not inside a request (scripts, tests without runAs)
  }
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session?.user.id ?? null;
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
  const userId = await sessionUserId();
  if (!userId) return null;
  const user = await getUser(userId);
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleCode: user.roleCode,
    permissions: await permissionsOfRole(user.roleCode),
  };
}

const cachedForRequest = cache(loadCurrentUser);

/** The acting user (runAs context, else the session cookie), or null. Inactive users count as signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Outside a React server render (tests, scripts) cache() does not memoize, which is what we want.
  return getActorContext() ? loadCurrentUser() : cachedForRequest();
}

export function can(user: CurrentUser | null, permission: Permission): boolean {
  return !!user && user.permissions.has(permission);
}

/**
 * Returns the current user if they hold `permission`; otherwise writes an `auth.denied` audit
 * row (outside any caller transaction, so it survives the rollback) and throws.
 * Call it first in every server action, route handler and protected page.
 */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (can(user, permission)) return user as CurrentUser;
  await audit(getDb(), {
    action: "auth.denied",
    entity: "permission",
    entityId: permission,
    after: { permission, roleCode: user?.roleCode ?? null },
    userId: user?.id ?? null,
  });
  if (!user) throw new UnauthenticatedError();
  throw new ForbiddenError(permission);
}

/** Segregation of duties: the person who prepared a document can't approve it. */
export function assertNotSameUser(preparerId: string, approverId: string): void {
  if (preparerId === approverId) throw new SodError("Segregation of duties: preparer cannot approve");
}
