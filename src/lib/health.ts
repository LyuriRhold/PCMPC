import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businessToday, type BusinessDate } from "@/lib/dates";
import pkg from "../../package.json";

export type HealthReport = {
  version: string;
  environment: string;
  businessDate: BusinessDate;
  db: { ok: true } | { ok: false; error: string };
};

/** `SELECT 1` against the app database; never throws. */
export async function checkDb(): Promise<HealthReport["db"]> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function healthReport(): Promise<HealthReport> {
  return {
    version: pkg.version,
    environment: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    businessDate: businessToday(),
    db: await checkDb(),
  };
}
