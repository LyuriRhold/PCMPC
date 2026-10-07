import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** The handle passed to `withTx` callbacks; every business write in a transaction goes through it. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DbGlobal = { __pcmpcPool?: Pool; __pcmpcDb?: Db };
const g = globalThis as DbGlobal;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** Shared pool, reused across hot reloads in dev so connections are not leaked. */
export function getPool(): Pool {
  g.__pcmpcPool ??= new Pool({ connectionString: databaseUrl(), max: 10 });
  return g.__pcmpcPool;
}

export function getDb(): Db {
  g.__pcmpcDb ??= drizzle(getPool(), { schema });
  return g.__pcmpcDb;
}

/**
 * Runs `fn` in one database transaction. If `fn` throws, everything it wrote is rolled back.
 * Ledger-first rule: the business record and its `postJournal()` call share this `tx`.
 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>, database: Db = getDb()): Promise<T> {
  return database.transaction(fn);
}

/** Closes the shared pool (scripts and test teardown). */
export async function closeDb(): Promise<void> {
  const pool = g.__pcmpcPool;
  g.__pcmpcPool = undefined;
  g.__pcmpcDb = undefined;
  if (pool) await pool.end();
}
