import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { DB_WORKERS, testDatabaseUrl, workerDatabaseName } from "./db-env";

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

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function prepare(): Promise<void> {
  const url = testDatabaseUrl();
  if (!(await reachable(url))) {
    execFileSync(process.execPath, ["scripts/db.mjs", "up"], { stdio: "inherit", timeout: 200_000 });
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await runMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }

  // One copy of the migrated test database per worker, so DB test files can run in parallel.
  const base = decodeURIComponent(new URL(url).pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const server = new Pool({ connectionString: admin.toString(), max: 1 });
  try {
    for (let id = 1; id <= DB_WORKERS; id++) {
      const name = workerDatabaseName(id);
      await server.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
      await server.query(`DROP DATABASE IF EXISTS ${ident(name)}`);
      await server.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(base)}`);
    }
  } finally {
    await server.end();
  }
}

let once: Promise<void> | null = null;

/**
 * Runs before the DB projects (once per `vitest run`, shared by both projects): makes sure the
 * local server is up (the portable Postgres does not survive reboots; `db:up` starts it), brings
 * the test database up to the latest migration, and clones it for each worker.
 */
export default async function setup(): Promise<void> {
  once ??= prepare();
  await once;
}
