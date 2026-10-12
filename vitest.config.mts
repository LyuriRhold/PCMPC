import { existsSync } from "node:fs";
import { freemem } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

// Workers for DB tests; each gets its own copy of the test database (tests/global-setup-db.ts).
// Published as an env var so the setup files (main process and workers) agree on the count.
// Each worker needs ~0.75 GB of free memory (Node with the PDF/Excel libraries, its Postgres
// backend, file cache). With less, Windows pages to disk and every test slows past its timeout
// (4 workers with 2.6 GB free: 532 s and 4 timeouts; 2 workers with 1.8 GB free: 360 s, green),
// so run as many as fit (1–4). PCMPC_TEST_WORKERS=<n> overrides. The config is loaded by more
// than one process: the first one decides and the others inherit VITEST_DB_WORKERS.
const freeGb = freemem() / 2 ** 30;
const DB_WORKERS =
  Number(process.env.VITEST_DB_WORKERS) || Number(process.env.PCMPC_TEST_WORKERS) || Math.max(1, Math.min(4, Math.floor(freeGb / 0.75)));
if (!process.env.VITEST_DB_WORKERS && DB_WORKERS < 4) console.log(`vitest: ${DB_WORKERS} DB worker(s); only ${freeGb.toFixed(1)} GB of memory is free`);
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
