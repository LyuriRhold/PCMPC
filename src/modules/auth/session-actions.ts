"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth-guard";
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

/** Ends the session and returns to the login page. */
export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  const h = await headers();
  await getAuth().api.signOut({ headers: h });
  if (user) await audit(getDb(), { action: "auth.logout", entity: "user", entityId: user.id, userId: user.id });
  redirect("/login");
}
