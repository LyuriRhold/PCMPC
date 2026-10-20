import { eq } from "drizzle-orm";
import { withTx } from "../../src/db/client";
import { users } from "../../src/modules/auth/schema";
import { createUser } from "../../src/modules/auth/service";

/**
 * DEMO ONLY: accounts for client demos on a local database: the general manager.
 * Password: SEED_DEMO_PASSWORD, or the default below (change it in Admin › Users after the demo).
 */
export const DEMO_USERS = [{ username: "manager", fullName: "General Manager (demo)", roleCode: "MANAGER" }] as const;

export async function ensureDemoUsers(adminId: string | null): Promise<void> {
  const password = process.env.SEED_DEMO_PASSWORD || "GmDemo-2026";
  await withTx(async (tx) => {
    for (const u of DEMO_USERS) {
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.username, u.username));
      if (exists) {
        console.log(`demo user "${u.username}": already present`);
        continue;
      }
      await createUser(tx, { username: u.username, fullName: u.fullName, roleCode: u.roleCode, password, email: null }, adminId);
      console.log(`demo user "${u.username}" (${u.roleCode}): created`);
    }
  });
}
