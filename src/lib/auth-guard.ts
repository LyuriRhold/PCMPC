import { cache } from "react";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getActorContext, runAs } from "@/lib/request-context";
import { effectiveRole, type Permission } from "@/modules/auth/permissions";
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

/**
 * Segregation of duties was violated (the preparer tried to approve). It is a kind of Forbidden:
 * the user may hold the permission, but not for a document they prepared.
 */
export class SodError extends ForbiddenError {
  override name = "SodError";
  constructor(message: string) {
    super("segregation_of_duties");
    this.message = message;
  }
}

export type CurrentUser = {
  id: string;
  username: string;
  name: string;
  /** The role in effect: the user's own, or the one the super admin is viewing as. */
  roleCode: string;
  permissions: ReadonlySet<string>;
  /** The user's own role. */
  realRoleCode: string;
  /** Set while the super admin views the system as another role. */
  actingAs: string | null;
};

/** Cookie with the role the super admin views the system as (honored only for ADMIN users). */
export const VIEW_AS_COOKIE = "pcmpc_view_as";

/** The view-as cookie of the request (none under runAs: tests and scripts). */
async function viewAsCookie(): Promise<string | null> {
  if (getActorContext()) return null;
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(VIEW_AS_COOKIE)?.value ?? null;
  } catch (e) {
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(e);
    return null;
  }
}

async function sessionUserId(): Promise<string | null> {
  const actor = getActorContext();
  if (actor) return actor.userId;
  let requestHeaders: Headers;
  try {
    const { headers } = await import("next/headers");
    requestHeaders = await headers();
  } catch (e) {
    // Let Next.js handle its own signals (e.g. "this part is dynamic" during prerendering).
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(e);
    return null; // not inside a request (scripts, tests without runAs)
  }
  // A session check is always request-time work (Better Auth reads the clock), never prerendered.
  const { connection } = await import("next/server");
  await connection();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session?.user.id ?? null;
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
  const userId = await sessionUserId();
  if (!userId) return null;
  const user = await getUser(userId);
  if (!user || !user.isActive) return null;
  const roleCode = user.roleCode === "ADMIN" ? effectiveRole(user.roleCode, await viewAsCookie()) : user.roleCode;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleCode,
    permissions: await permissionsOfRole(roleCode),
    realRoleCode: user.roleCode,
    actingAs: roleCode === user.roleCode ? null : roleCode,
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
