import { afterAll, beforeEach } from "vitest";
import { closeDb, getPool } from "@/db/client";
import { DB_WORKERS, testDatabaseUrl, workerDatabaseUrl } from "./db-env";

// Each worker uses its own copy of the test database (made by global-setup-db.ts), so DB test
// files run in parallel. Every DB test gets an empty schema: truncate all tables in `public`
// before each test. The migration history lives in the `drizzle` schema and is left alone.
if (process.env.DATABASE_URL !== testDatabaseUrl()) {
  throw new Error("DB tests must run with DATABASE_URL = DATABASE_URL_TEST (see vitest.config.ts)");
}
const worker = Number(process.env.VITEST_POOL_ID ?? "1");
if (!Number.isInteger(worker) || worker < 1 || worker > DB_WORKERS) {
  throw new Error(`Vitest worker ${process.env.VITEST_POOL_ID} has no test database (DB_WORKERS = ${DB_WORKERS})`);
}
process.env.DATABASE_URL = workerDatabaseUrl(worker);

let resetSql: string | null = null;

/**
 * Empties every table in `public` and restarts its sequences. TRUNCATE took ~2.5 s per test (it
 * recreates ~40 tables' files), so this deletes the rows instead, in one transaction with
 * session_replication_role = replica: foreign keys and the immutability triggers (ledger, bills)
 * are off for that transaction only. The test role is the local superuser.
 */
export async function truncateAll(): Promise<void> {
  const pool = getPool();
  if (resetSql === null) {
    const tables = await pool.query<{ name: string }>("SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'");
    const sequences = await pool.query<{ name: string }>("SELECT quote_ident(sequencename) AS name FROM pg_sequences WHERE schemaname = 'public'");
    resetSql = [
      "BEGIN",
      "SET LOCAL session_replication_role = replica",
      ...tables.rows.map((r) => `DELETE FROM public.${r.name}`),
      ...sequences.rows.map((r) => `ALTER SEQUENCE public.${r.name} RESTART`),
      "COMMIT",
    ].join(";\n");
  }
  await pool.query(resetSql);
}

beforeEach(truncateAll);

afterAll(closeDb);
