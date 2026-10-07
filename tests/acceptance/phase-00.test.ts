import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import * as dates from "@/lib/dates";
import * as money from "@/lib/money";

// Golden values from docs/phases/PHASE-00-foundation.md › Acceptance tests.

describe("Phase 00 acceptance", () => {
  it("A0.1 parse 1,234.56 → 123456n; format 123456n → ₱1,234.56; format -5000n → -₱50.00", () => {
    expect(money.parse("1,234.56")).toBe(123456n);
    expect(money.format(123456n)).toBe("₱1,234.56");
    expect(money.format(-5000n)).toBe("-₱50.00");
  });

  it("A0.2 mulRate(₱916.80, 0.02) HALF-UP → ₱18.34 (1834n)", () => {
    expect(money.mulRate(91680n, "0.02", "HALF_UP")).toBe(1834n);
    expect(money.mulRate(91680n, "0.02")).toBe(1834n);
  });

  it("A0.3 mulRate(₱0.25, 0.5) HALF-UP → ₱0.13 (12.5 centavos → 13)", () => {
    expect(money.mulRate(25n, "0.5", "HALF_UP")).toBe(13n);
    expect(money.mulRate(25n, "0.5")).toBe(13n);
  });

  it("A0.4 allocate(₱100.00, [1,1,1]) → [₱33.34, ₱33.33, ₱33.33], sum = ₱100.00", () => {
    const parts = money.allocate(10000n, [1, 1, 1]);
    expect(parts).toEqual([3334n, 3333n, 3333n]);
    expect(money.sum(parts)).toBe(10000n);
  });

  it("A0.5 businessToday() at clock 2026-10-06T16:30:00Z → 2026-10-07 (Manila is UTC+8)", () => {
    expect(dates.businessToday(new Date("2026-10-06T16:30:00Z"))).toBe("2026-10-07");
    expect(dates.businessToday(() => new Date("2026-10-06T16:30:00Z"))).toBe("2026-10-07");
  });

  it("A0.6 addMonths(2026-01-31, 1) → 2026-02-28; addMonths(2028-01-31, 1) → 2028-02-29", () => {
    expect(dates.addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(dates.addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("A0.7 daysBetween(2026-01-01, 2026-04-01) → 90", () => {
    expect(dates.daysBetween("2026-01-01", "2026-04-01")).toBe(90);
  });

  describe("A0.8 placeholder scanner", () => {
    const scan = (root: string) =>
      spawnSync(process.execPath, ["scripts/scan-placeholders.mjs", "--root", root], { encoding: "utf8" });

    it("A0.8 fixtures with a TODO comment and an it-dot-only call → exit 1 and both lines reported", () => {
      const r = scan("tests/fixtures/scan/dirty");
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/^src\/bad\.ts:3: TODO$/m);
      expect(r.stdout).toMatch(/^tests\/bad\.test\.ts:4: \.only\($/m);
    });

    it("A0.8 clean fixture → exit 0", () => {
      const r = scan("tests/fixtures/scan/clean");
      expect(r.stdout + r.stderr).not.toMatch(/:\d+: /);
      expect(r.status).toBe(0);
    });
  });

  describe("A0.9 withTx rollback", () => {
    const probe = sql.raw("public.acc_phase00_probe");

    beforeAll(async () => {
      await getDb().execute(sql`CREATE TABLE IF NOT EXISTS ${probe} (id serial PRIMARY KEY, note text NOT NULL)`);
    });
    afterAll(async () => {
      await getDb().execute(sql`DROP TABLE IF EXISTS ${probe}`);
    });

    it("A0.9 insert a row in withTx, then throw → the row does not exist afterward", async () => {
      await expect(
        withTx(async (tx) => {
          await tx.execute(sql`INSERT INTO ${probe} (note) VALUES ('should roll back')`);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const { rows } = await getDb().execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${probe}`);
      expect(rows[0]?.n).toBe("0");
    });
  });
});
