import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { testDatabaseUrl } from "./db-env";

/** Runs once per `vitest run`: brings the test database up to the latest migration. */
export default async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
  try {
    await runMigrations(drizzle(pool));
  } finally {
    await pool.end();
  }
}
