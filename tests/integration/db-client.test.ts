import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";

const probe = sql.raw("public.it_db_client_probe");

describe("db client", () => {
  beforeAll(async () => {
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS ${probe} (id serial PRIMARY KEY, note text NOT NULL)`);
  });
  afterAll(async () => {
    await getDb().execute(sql`DROP TABLE IF EXISTS ${probe}`);
  });

  it("connects to the *_test database", async () => {
    const { rows } = await getDb().execute<{ db: string }>(sql`SELECT current_database() AS db`);
    expect(rows[0]?.db).toMatch(/_test$/);
  });

  it("withTx commits when the callback resolves and returns its value", async () => {
    const id = await withTx(async (tx) => {
      const { rows } = await tx.execute<{ id: number }>(sql`INSERT INTO ${probe} (note) VALUES ('kept') RETURNING id`);
      return rows[0]?.id;
    });
    expect(id).toBe(1);
    const { rows } = await getDb().execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${probe}`);
    expect(rows[0]?.n).toBe("1");
  });

  it("tables are truncated between tests (identity restarts)", async () => {
    const { rows } = await getDb().execute<{ id: number }>(sql`INSERT INTO ${probe} (note) VALUES ('fresh') RETURNING id`);
    expect(rows[0]?.id).toBe(1);
  });
});
