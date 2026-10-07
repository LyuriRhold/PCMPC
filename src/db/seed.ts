import type { Tx } from "./client";

export type SeedStep = {
  name: string;
  run: (tx: Tx) => Promise<void>;
};

/**
 * Reference-data seed steps, in run order. Each phase appends its own steps
 * (roles, settings, chart of accounts, tariffs, ...). Steps must be idempotent.
 */
export const SEED_STEPS: SeedStep[] = [];
