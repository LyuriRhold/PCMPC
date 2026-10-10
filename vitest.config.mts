import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

// Workers for DB tests; each gets its own copy of the test database (tests/global-setup-db.ts).
// Published as an env var so the setup files (main process and workers) agree on the count.
const DB_WORKERS = 4;
process.env.VITEST_DB_WORKERS = String(DB_WORKERS);

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
// DB tests (integration + acceptance) always run against the test database.
const dbEnv = { DATABASE_URL: process.env.DATABASE_URL_TEST ?? "", TZ: "UTC" };
// DB tests build real fixtures through the actions (e.g. A8.6 makes 37 paying members); on a busy
// machine that can pass Vitest's 5 s default. A timed-out test keeps querying while the next test
// resets the database, so it must not time out early.
const dbTimeouts = { testTimeout: 30_000, hookTimeout: 30_000 };

export default defineConfig({
  resolve: { alias },
  test: {
    // Each worker has its own copy of the test database (tests/global-setup-db.ts), so files run in
    // parallel; the worker count is capped at the number of database copies.
    maxWorkers: DB_WORKERS,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          env: { TZ: "UTC" },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/global-setup-db.ts"],
          setupFiles: ["tests/setup-db.ts"],
          env: dbEnv,
          ...dbTimeouts,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "acceptance",
          environment: "node",
          include: ["tests/acceptance/**/*.test.ts"],
          globalSetup: ["tests/global-setup-db.ts"],
          setupFiles: ["tests/setup-db.ts"],
          env: dbEnv,
          ...dbTimeouts,
        },
      },
    ],
  },
});
