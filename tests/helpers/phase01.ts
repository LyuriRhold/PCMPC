import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { getDb, getPool, withTx } from "@/db/client";
import { runSeedSteps } from "@/db/seed";
import { businessToday } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { createUser } from "@/modules/auth/service";

/** Default password for test users (≥ 10 characters). */
export const TEST_PASSWORD = "Correct-Horse-2026";

/**
 * Seeds reference data (roles, permissions, settings, number series, chart of accounts, the
 * current fiscal year, …) without the admin user.
 *
 * Nearly every DB test starts from an emptied database and seeds it again, which costs ~0.35 s a
 * test. So the first seed of an empty database (per worker database and business date: the fiscal
 * year seeded depends on the clock) runs the real seed steps and keeps a copy of the rows they
 * wrote in the `seedsnap` schema; later seeds of an emptied database on the same business date copy
 * those rows back in one transaction. Any other call (a database that isn't empty) runs the seed
 * steps as usual.
 */
export async function seedReference(): Promise<void> {
  const pool = getPool();
  const key = businessToday();
  const empty = (await pool.query<{ empty: boolean }>("SELECT NOT EXISTS (SELECT 1 FROM public.roles) AS empty")).rows[0]?.empty ?? false;
  if (empty) {
    const restore = await snapshotFor(pool, key);
    if (restore) {
      await pool.query(restore);
      return;
    }
  }
  await withTx((tx) => runSeedSteps(tx, { includeAdmin: false }));
  if (empty) await takeSnapshot(pool, key);
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The SQL that restores the snapshot taken on `key`, or null if there is none. */
async function snapshotFor(pool: Pool, key: string): Promise<string | null> {
  const exists = (await pool.query<{ t: string | null }>("SELECT to_regclass('seedsnap.meta')::text AS t")).rows[0]?.t;
  if (!exists) return null;
  const [meta] = (await pool.query<{ key: string; restore: string }>("SELECT key, restore FROM seedsnap.meta")).rows;
  return meta?.key === key ? meta.restore : null;
}

/** Copies every table the seed wrote, and the sequences' positions, into `seedsnap`. */
async function takeSnapshot(pool: Pool, key: string): Promise<void> {
  const tables = (await pool.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.name);
  const filled: string[] = [];
  for (const t of tables) if ((await pool.query(`SELECT 1 FROM public.${ident(t)} LIMIT 1`)).rowCount) filled.push(t);
  const sequences = (await pool.query<{ name: string; last: string | null }>("SELECT sequencename AS name, last_value::text AS last FROM pg_sequences WHERE schemaname = 'public'")).rows.filter((s) => s.last !== null);
  const restore = [
    "BEGIN",
    // Foreign keys and the immutability triggers are off for this transaction only (as in truncateAll).
    "SET LOCAL session_replication_role = replica",
    ...filled.map((t) => `INSERT INTO public.${ident(t)} OVERRIDING SYSTEM VALUE SELECT * FROM seedsnap.${ident(t)}`),
    ...sequences.map((s) => `SELECT setval('public.${ident(s.name)}', ${Number(s.last)}, true)`),
    "COMMIT",
  ].join(";\n");
  await pool.query(
    [
      "BEGIN",
      "DROP SCHEMA IF EXISTS seedsnap CASCADE",
      "CREATE SCHEMA seedsnap",
      ...filled.map((t) => `CREATE TABLE seedsnap.${ident(t)} AS SELECT * FROM public.${ident(t)}`),
      "CREATE TABLE seedsnap.meta (key text NOT NULL, restore text NOT NULL)",
      "COMMIT",
    ].join(";\n"),
  );
  await pool.query("INSERT INTO seedsnap.meta (key, restore) VALUES ($1, $2)", [key, restore]);
}

/** Creates an active user with the given role, as the system (no acting user). */
export async function makeUser(roleCode: string, username: string, password = TEST_PASSWORD) {
  return withTx((tx) =>
    createUser(tx, { username, fullName: `${roleCode} ${username}`, roleCode, password, email: null }, null),
  );
}

export async function loadUser(username: string) {
  const [row] = await getDb().select().from(users).where(eq(users.username, username));
  if (!row) throw new Error(`user ${username} not found`);
  return row;
}
