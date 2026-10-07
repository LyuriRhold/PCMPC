import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export const MIGRATIONS_FOLDER = "./drizzle";

/** Applies every pending migration in ./drizzle. Shared by `db:migrate` and the test-DB setup. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsTable: "__drizzle_migrations", migrationsSchema: "drizzle" });
}
