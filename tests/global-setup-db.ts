import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { testDatabaseUrl } from "./db-env";

async function reachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

/**
 * Runs once per `vitest run`: makes sure the local server is up (the portable Postgres does
 * not survive reboots or app restarts; `db:up` starts it and creates missing databases), then
 * brings the test database up to the latest migration.
 */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  if (!(await reachable(url))) {
    execFileSync(process.execPath, ["scripts/db.mjs", "up"], { stdio: "inherit", timeout: 90_000 });
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await runMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }
}
