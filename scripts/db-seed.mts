import { existsSync } from "node:fs";
import { closeDb, withTx } from "../src/db/client";
import { SEED_STEPS } from "../src/db/seed";

if (existsSync(".env")) process.loadEnvFile(".env");

await withTx(async (tx) => {
  for (const step of SEED_STEPS) {
    await step.run(tx);
    console.log(`seeded: ${step.name}`);
  }
});
console.log(`seed complete (${SEED_STEPS.length} steps)`);
await closeDb();
