import { redirect } from "next/navigation";
import { ForbiddenError, requirePermission, UnauthenticatedError, type CurrentUser } from "@/lib/auth-guard";
import type { Permission } from "@/modules/auth/permissions";

export type PageAccess = { ok: true; user: CurrentUser } | { ok: false; permission: Permission };

/**
 * Server-side permission check for a protected page. Signed-out users are sent to /login;
 * users without the permission get `{ ok: false }` (the page renders <Forbidden />), and the
 * denial is audited by requirePermission().
 */
export async function guardPage(permission: Permission): Promise<PageAccess> {
  try {
    return { ok: true, user: await requirePermission(permission) };
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    if (e instanceof ForbiddenError) return { ok: false, permission };
    throw e;
  }
}
