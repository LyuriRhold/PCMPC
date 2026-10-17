import type { Tx } from "./client";
import { seedAdmin, seedRoles } from "@/modules/auth/service";
import { seedFs } from "@/modules/accounting/seed";
import { seedCoa } from "@/modules/ledger/coa";
import { seedCurrentFiscalYear } from "@/modules/ledger/periods";
import { seedWater } from "@/modules/water/seed";
import { seedDepositProducts } from "@/modules/savings/seed";
import { seedLoanProducts } from "@/modules/loans/seed";
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
  { name: "chart of accounts + account mappings (DOMAIN §6)", run: seedCoa },
  { name: "fiscal year and periods", run: seedCurrentFiscalYear },
  { name: "financial statement lines, segments and asset classes (PFRF for Cooperatives, CONFIRM)", run: seedFs },
  { name: "water zones/routes, sample tariff versions and fees (CONFIRM)", run: seedWater },
  { name: "deposit products: Regular Savings, Time Deposit (CONFIRM)", run: seedDepositProducts },
  { name: "loan products REG, EMR, PRD and their deductions (DOMAIN samples, CONFIRM)", run: seedLoanProducts },
];

/**
 * The first admin when SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD aren't set (Rhold's choice,
 * 2026-10-17): change the password after the first sign-in (Admin › Users).
 */
export const DEFAULT_ADMIN = { username: "admin", password: "Pass123456" } as const;

/** The first admin, from SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD, or DEFAULT_ADMIN. Never replaces an existing one. */
export const ADMIN_STEP: SeedStep = {
  name: "first admin user",
  run: async (tx) => {
    const username = process.env.SEED_ADMIN_USERNAME || DEFAULT_ADMIN.username;
    const fromEnv = !!process.env.SEED_ADMIN_PASSWORD;
    const password = process.env.SEED_ADMIN_PASSWORD || DEFAULT_ADMIN.password;
    const result = await seedAdmin(tx, { username, password, fullName: "System Administrator" });
    console.log(`  admin "${username}": ${result}${result === "created" && !fromEnv ? " with the default password; change it after the first sign-in" : ""}`);
  },
};

export async function runSeedSteps(tx: Tx, opts: { includeAdmin: boolean; log?: (name: string) => void }): Promise<void> {
  const steps = opts.includeAdmin ? [...SEED_STEPS, ADMIN_STEP] : SEED_STEPS;
  for (const step of steps) {
    await step.run(tx);
    opts.log?.(step.name);
  }
}
