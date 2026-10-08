import type { Tx } from "./client";
import { seedAdmin, seedRoles } from "@/modules/auth/service";
import { seedNumberSeries } from "@/modules/numbering/series";
import { seedSettings } from "@/modules/settings/service";

export type SeedStep = {
  name: string;
  run: (tx: Tx) => Promise<void>;
};

/**
 * Reference-data seed steps, in run order. Each phase appends its own steps
 * (roles, settings, chart of accounts, tariffs, ...). Steps must be idempotent.
 */
export const SEED_STEPS: SeedStep[] = [
  { name: "roles & permission matrix", run: seedRoles },
  { name: "settings defaults (DOMAIN §2)", run: seedSettings },
  { name: "number series (DOMAIN §5)", run: seedNumberSeries },
];

/** The first admin, from SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD. */
export const ADMIN_STEP: SeedStep = {
  name: "first admin user",
  run: async (tx) => {
    const username = process.env.SEED_ADMIN_USERNAME;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!username || !password) {
      throw new Error("Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD (at least 10 characters) in .env before seeding");
    }
    const result = await seedAdmin(tx, { username, password, fullName: "System Administrator" });
    console.log(`  admin "${username}": ${result}`);
  },
};

export async function runSeedSteps(tx: Tx, opts: { includeAdmin: boolean; log?: (name: string) => void }): Promise<void> {
  const steps = opts.includeAdmin ? [...SEED_STEPS, ADMIN_STEP] : SEED_STEPS;
  for (const step of steps) {
    await step.run(tx);
    opts.log?.(step.name);
  }
}
