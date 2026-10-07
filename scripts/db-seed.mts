import { existsSync } from "node:fs";
import { closeDb, withTx } from "../src/db/client";
import { runSeedSteps } from "../src/db/seed";

if (existsSync(".env")) process.loadEnvFile(".env");

let count = 0;
await withTx((tx) =>
  runSeedSteps(tx, {
    includeAdmin: true,
    log: (name) => {
      count += 1;
      console.log(`seeded: ${name}`);
    },
  }),
);
console.log(`seed complete (${count} steps)`);
await closeDb();
