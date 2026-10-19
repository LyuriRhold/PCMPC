"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { ForbiddenError, getCurrentUser, UnauthenticatedError, VIEW_AS_COOKIE } from "@/lib/auth-guard";
import { isRoleCode } from "./permissions";
import { AuthError, signIn } from "./service";

export type LoginState = { error: string | null };

const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username").max(100),
  password: z.string().min(1, "Enter your password").max(128),
  next: z.string().max(500).optional(),
});

/** Only same-site paths are allowed as the post-login destination. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

/** Signs in with username + password (Better Auth sets the session cookie), then redirects. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await signIn({ username: parsed.data.username, password: parsed.data.password }, await headers());
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
  redirect(safeNext(parsed.data.next));
}

const viewAsSchema = z.object({ role: z.string().trim().max(40).nullable() });

/**
 * The super admin views the system as another role (its screens and permissions), or, with null
 * or ADMIN, as the administrator again. Only a user whose own role is ADMIN may do it; each switch
 * is audited. A document's preparer ≠ approver rule still applies: it is the same person.
 */
export async function viewAsRoleAction(input: z.input<typeof viewAsSchema>): Promise<ActionResult<null>> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (user.realRoleCode !== "ADMIN") {
    await audit(getDb(), { action: "auth.denied", entity: "permission", entityId: "view_as", after: { roleCode: user.realRoleCode }, userId: user.id });
    throw new ForbiddenError("view_as");
  }
  try {
    const { role } = viewAsSchema.parse(input);
    const target = role && role !== "ADMIN" ? role : null;
    if (target && !isRoleCode(target)) return { ok: false, error: "Choose a role" };
    const jar = await cookies();
    if (target) jar.set(VIEW_AS_COOKIE, target, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    else jar.delete(VIEW_AS_COOKIE);
    await audit(getDb(), { action: "auth.view_as", entity: "user", entityId: user.id, before: { role: user.actingAs ?? "ADMIN" }, after: { role: target ?? "ADMIN" }, userId: user.id });
    return ok(null);
  } catch (e) {
    return failFrom(e, []);
  }
}

/** Ends the session and returns to the login page. */
export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  const h = await headers();
  (await cookies()).delete(VIEW_AS_COOKIE);
  await getAuth().api.signOut({ headers: h });
  if (user) await audit(getDb(), { action: "auth.logout", entity: "user", entityId: user.id, userId: user.id });
  redirect("/login");
}
