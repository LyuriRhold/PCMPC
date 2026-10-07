import { isAPIError } from "better-auth/api";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { now } from "@/lib/dates";
import { getSetting } from "@/modules/settings/service";
import { accounts, rolePermissions, roles, sessions, users, type User } from "./schema";
import { ROLE_PERMISSIONS, ROLES, isRoleCode } from "./permissions";

export class SignInBlockedError extends Error {
  override name = "SignInBlockedError";
}

/** Sign-in rejected: wrong credentials, locked or inactive account. The message is safe to show. */
export class AuthError extends Error {
  override name = "AuthError";
}

/** A business rule on users was broken (duplicate username, self-demotion, …). */
export class UserRuleError extends Error {
  override name = "UserRuleError";
}

export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

export type UserSummary = Pick<
  User,
  "id" | "username" | "name" | "email" | "roleCode" | "isActive" | "failedAttempts" | "lockedUntil" | "lastLoginAt" | "createdAt"
>;

/** The audit-safe view of a user (no hash, no secrets). */
function auditView(u: User) {
  return {
    username: u.username,
    fullName: u.name,
    email: u.email,
    roleCode: u.roleCode,
    isActive: u.isActive,
  };
}

async function hashPassword(password: string): Promise<string> {
  const ctx = await getAuth().$context;
  return ctx.password.hash(password);
}

async function assertPasswordPolicy(password: string, db: Db | Tx): Promise<void> {
  const min = await getSetting("auth.min_password_length", db);
  if (password.length < min) throw new UserRuleError(`Password must be at least ${min} characters`);
  if (password.length > 128) throw new UserRuleError("Password must be at most 128 characters");
}

function assertRole(roleCode: string): void {
  if (!isRoleCode(roleCode)) throw new UserRuleError(`Unknown role "${roleCode}"`);
}

async function loadForUpdate(tx: Tx, userId: string): Promise<User> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  if (!u) throw new UserRuleError("User not found");
  return u;
}

export type CreateUserInput = {
  username: string;
  fullName: string;
  email: string | null;
  roleCode: string;
  password: string;
};

/** Creates a staff user with a credential (password) account. `actorId` null = system/seed. */
export async function createUser(tx: Tx, input: CreateUserInput, actorId: string | null): Promise<User> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new UserRuleError("Username must be 3–30 characters: lowercase letters, digits, dot or underscore");
  }
  assertRole(input.roleCode);
  await assertPasswordPolicy(input.password, tx);

  const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (taken) throw new UserRuleError(`Username "${username}" is already taken`);

  const at = now();
  const [user] = await tx
    .insert(users)
    .values({
      username,
      name: input.fullName.trim(),
      email: input.email?.trim() || null,
      roleCode: input.roleCode,
      createdBy: actorId,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (!user) throw new Error("user insert returned no row");

  await tx.insert(accounts).values({
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await hashPassword(input.password),
    createdAt: at,
    updatedAt: at,
  });
  await audit(tx, { action: "user.create", entity: "user", entityId: user.id, before: null, after: auditView(user), userId: actorId });
  return user;
}

export type UpdateUserInput = { userId: string; fullName: string; email: string | null; roleCode: string };

/** Edits name, e-mail and role. An admin can't change their own role (no self-demotion). */
export async function updateUser(tx: Tx, input: UpdateUserInput, actorId: string): Promise<User> {
  assertRole(input.roleCode);
  const before = await loadForUpdate(tx, input.userId);
  if (input.userId === actorId && input.roleCode !== before.roleCode) {
    throw new UserRuleError("You can't change your own role");
  }
  const [after] = await tx
    .update(users)
    .set({ name: input.fullName.trim(), email: input.email?.trim() || null, roleCode: input.roleCode, updatedAt: now() })
    .where(eq(users.id, input.userId))
    .returning();
  if (!after) throw new Error("user update returned no row");
  if (before.roleCode !== after.roleCode) await tx.delete(sessions).where(eq(sessions.userId, after.id));
  await audit(tx, { action: "user.update", entity: "user", entityId: after.id, before: auditView(before), after: auditView(after), userId: actorId });
  return after;
}

/** Activates or deactivates a user (users are never deleted). Deactivation ends their sessions. */
export async function setUserActive(tx: Tx, userId: string, active: boolean, actorId: string): Promise<User> {
  const before = await loadForUpdate(tx, userId);
  if (!active && userId === actorId) throw new UserRuleError("You can't deactivate yourself");
  if (before.isActive === active) return before;
  const [after] = await tx
    .update(users)
    .set({ isActive: active, failedAttempts: 0, lockedUntil: null, updatedAt: now() })
    .where(eq(users.id, userId))
    .returning();
  if (!after) throw new Error("user update returned no row");
  if (!active) await tx.delete(sessions).where(eq(sessions.userId, userId));
  await audit(tx, {
    action: active ? "user.activate" : "user.deactivate",
    entity: "user",
    entityId: userId,
    before: auditView(before),
    after: auditView(after),
    userId: actorId,
  });
  return after;
}

/** Sets a new password, clears any lockout and signs the user out everywhere. */
export async function resetPassword(tx: Tx, userId: string, password: string, actorId: string): Promise<void> {
  await assertPasswordPolicy(password, tx);
  const before = await loadForUpdate(tx, userId);
  const at = now();
  const updated = await tx
    .update(accounts)
    .set({ password: await hashPassword(password), updatedAt: at })
    .where(sql`${accounts.userId} = ${userId} AND ${accounts.providerId} = 'credential'`)
    .returning({ id: accounts.id });
  if (updated.length === 0) {
    await tx.insert(accounts).values({ accountId: userId, providerId: "credential", userId, password: await hashPassword(password), createdAt: at, updatedAt: at });
  }
  await tx.update(users).set({ failedAttempts: 0, lockedUntil: null, updatedAt: at }).where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await audit(tx, { action: "user.reset_password", entity: "user", entityId: userId, before: auditView(before), after: auditView(before), userId: actorId });
}

export async function listUsers(db: Db | Tx = getDb()): Promise<UserSummary[]> {
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      roleCode: users.roleCode,
      isActive: users.isActive,
      failedAttempts: users.failedAttempts,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.username));
}

export async function getUser(userId: string, db: Db | Tx = getDb()): Promise<User | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u ?? null;
}

/** Permission codes granted to a role. */
export async function permissionsOfRole(roleCode: string, db: Db | Tx = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleCode, roleCode));
  return new Set(rows.map((r) => r.code));
}

export async function listRolePermissions(db: Db | Tx = getDb()) {
  const [roleRows, grants] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.id)),
    db.select().from(rolePermissions),
  ]);
  return { roles: roleRows, grants: grants.map((g) => `${g.roleCode}:${g.permissionCode}`) };
}

/** Seeds roles and the default permission matrix. Idempotent. */
export async function seedRoles(tx: Tx): Promise<void> {
  await tx.insert(roles).values(ROLES.map((r) => ({ code: r.code, name: r.name }))).onConflictDoNothing({ target: roles.code });
  const grants = Object.entries(ROLE_PERMISSIONS).flatMap(([roleCode, perms]) =>
    perms.map((permissionCode) => ({ roleCode, permissionCode })),
  );
  await tx.insert(rolePermissions).values(grants).onConflictDoNothing();
}

/** Creates the first admin if no user with that username exists. */
export async function seedAdmin(tx: Tx, input: { username: string; password: string; fullName: string }): Promise<"created" | "exists"> {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.username, input.username.toLowerCase()));
  if (existing) return "exists";
  await createUser(tx, { ...input, email: null, roleCode: "ADMIN" }, null);
  return "created";
}

// ── Sign-in rules (called from the Better Auth hooks in src/lib/auth.ts) ──────────────────────

function normalize(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Runs before every username sign-in. Rejects inactive and locked accounts. When a lock has
 * expired it is cleared, and the failed-attempt count starts again from zero.
 */
export async function beforeSignIn(rawUsername: string): Promise<void> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.username, normalize(rawUsername)));
  if (!u) return;
  if (!u.isActive) {
    await audit(db, { action: "auth.login_rejected", entity: "user", entityId: u.id, after: { reason: "inactive" }, userId: u.id });
    throw new SignInBlockedError("Account is inactive. Contact the administrator.");
  }
  const at = now();
  if (u.lockedUntil && u.lockedUntil > at) {
    await audit(db, { action: "auth.login_rejected", entity: "user", entityId: u.id, after: { reason: "locked", lockedUntil: u.lockedUntil }, userId: u.id });
    throw new SignInBlockedError("Account locked after too many failed sign-ins. Try again later.");
  }
  if (u.lockedUntil) {
    await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, u.id));
  }
}

/** Runs after every username sign-in attempt: counts failures and locks, or resets on success. */
export async function afterSignInAttempt(rawUsername: string, success: boolean): Promise<void> {
  const db = getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, normalize(rawUsername)));
  if (!u) return;
  const at = now();
  if (success) {
    await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: at }).where(eq(users.id, u.id));
    await audit(db, { action: "auth.login", entity: "user", entityId: u.id, userId: u.id });
    return;
  }
  const [maxFailed, lockMinutes] = await Promise.all([
    getSetting("auth.max_failed_logins", db),
    getSetting("auth.lockout_minutes", db),
  ]);
  const lockUntil = new Date(at.getTime() + lockMinutes * 60_000);
  const [row] = await db
    .update(users)
    .set({
      failedAttempts: sql`${users.failedAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${users.failedAttempts} + 1 >= ${maxFailed} THEN ${lockUntil.toISOString()}::timestamptz ELSE ${users.lockedUntil} END`,
    })
    .where(eq(users.id, u.id))
    .returning({ failedAttempts: users.failedAttempts, lockedUntil: users.lockedUntil });
  await audit(db, {
    action: row?.lockedUntil ? "auth.locked" : "auth.login_failed",
    entity: "user",
    entityId: u.id,
    after: { failedAttempts: row?.failedAttempts, lockedUntil: row?.lockedUntil ?? null },
    userId: u.id,
  });
}

/**
 * Signs a user in with username + password through Better Auth (so the lockout hooks apply).
 * Pass the request headers so the session cookie is set; returns the new session's user.
 */
export async function signIn(input: { username: string; password: string }, headers: Headers = new Headers()) {
  try {
    return await getAuth().api.signInUsername({ body: { username: input.username, password: input.password }, headers });
  } catch (e) {
    if (isAPIError(e)) {
      const message = e.status === "UNAUTHORIZED" || e.status === "UNPROCESSABLE_ENTITY" ? "Invalid username or password" : e.message;
      throw new AuthError(message);
    }
    throw e;
  }
}
