import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { DB_WORKERS } from "./tests/db-env";

if (existsSync(".env")) process.loadEnvFile(".env");

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
// DB tests (integration + acceptance) always run against the test database.
const dbEnv = { DATABASE_URL: process.env.DATABASE_URL_TEST ?? "", TZ: "UTC" };

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
        },
      },
    ],
  },
});
