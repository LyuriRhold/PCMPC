import { afterEach, describe, expect, it } from "vitest";
import { setClock } from "@/lib/dates";
import { checkDb, healthReport } from "@/lib/health";

afterEach(() => setClock(null));

describe("health report", () => {
  it("reports DB ok, the Manila business date, version and environment", async () => {
    setClock(() => new Date("2026-10-06T16:30:00Z"));
    const r = await healthReport();
    expect(r.db).toEqual({ ok: true });
    expect(r.businessDate).toBe("2026-10-07");
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.environment.length).toBeGreaterThan(0);
  });

  it("checkDb returns ok against the test database", async () => {
    expect(await checkDb()).toEqual({ ok: true });
  });
});
