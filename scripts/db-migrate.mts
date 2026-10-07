import { existsSync } from "node:fs";
import { closeDb, getDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

if (existsSync(".env")) process.loadEnvFile(".env");

await runMigrations(getDb());
console.log("migrations applied");
await closeDb();
