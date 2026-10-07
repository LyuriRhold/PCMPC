import { eq } from "drizzle-orm";
import { getDb, withTx } from "@/db/client";
import { runSeedSteps } from "@/db/seed";
import { users } from "@/modules/auth/schema";
import { createUser } from "@/modules/auth/service";

/** Default password for test users (≥ 10 characters). */
export const TEST_PASSWORD = "Correct-Horse-2026";

/** Seeds reference data (roles, permissions, settings, number series) without the admin user. */
export async function seedReference(): Promise<void> {
  await withTx((tx) => runSeedSteps(tx, { includeAdmin: false }));
}

/** Creates an active user with the given role, as the system (no acting user). */
export async function makeUser(roleCode: string, username: string, password = TEST_PASSWORD) {
  return withTx((tx) =>
    createUser(tx, { username, fullName: `${roleCode} ${username}`, roleCode, password, email: null }, null),
  );
}

export async function loadUser(username: string) {
  const [row] = await getDb().select().from(users).where(eq(users.username, username));
  if (!row) throw new Error(`user ${username} not found`);
  return row;
}
