import { afterAll, beforeEach } from "vitest";
import { closeDb, getPool } from "@/db/client";
import { testDatabaseUrl } from "./db-env";

// Every DB test gets an empty schema: truncate all tables in `public` before each test.
// The migration history lives in the `drizzle` schema and is left alone.
const url = testDatabaseUrl();
if (process.env.DATABASE_URL !== url) {
  throw new Error("DB tests must run with DATABASE_URL = DATABASE_URL_TEST (see vitest.config.ts)");
}

export async function truncateAll(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ name: string }>(
    "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows.length === 0) return;
  await pool.query(`TRUNCATE ${rows.map((r) => `public.${r.name}`).join(", ")} RESTART IDENTITY CASCADE`);
}

beforeEach(truncateAll);

afterAll(closeDb);
