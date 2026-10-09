import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { hasRun, JobAlreadyRunError, runOnce } from "@/lib/jobs";
import { jobRuns } from "@/modules/jobs/schema";
import { seedReference } from "../helpers/phase01";

beforeEach(async () => {
  await seedReference();
});
afterEach(() => setClock(null));

describe("T6.1 runOnce", () => {
  it("runs a key once, stores the result, and refuses a second run", async () => {
    const out = await withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({ bills: 3, total: 120000n })));
    expect(out).toEqual({ bills: 3, total: 120000n });
    const [row] = await getDb().select().from(jobRuns).where(eq(jobRuns.key, "2026-10:Z1"));
    expect(row?.result).toEqual({ bills: 3, total: "120000" });
    expect(await hasRun(getDb(), "test-job", "2026-10:Z1")).toBe(true);
    await expect(withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({})))).rejects.toBeInstanceOf(JobAlreadyRunError);
    await expect(withTx((tx) => runOnce(tx, "test-job", "2026-10:Z1", null, async () => ({}), (k) => `${k} is already billed`))).rejects.toThrow("2026-10:Z1 is already billed");
  });

  it("a failed run leaves no claim, so it can be retried", async () => {
    await expect(withTx((tx) => runOnce(tx, "test-job", "k1", null, async () => Promise.reject(new Error("boom"))))).rejects.toThrow("boom");
    expect(await hasRun(getDb(), "test-job", "k1")).toBe(false);
    expect(await withTx((tx) => runOnce(tx, "test-job", "k1", null, async () => ({ ok: true })))).toEqual({ ok: true });
  });

  it("two concurrent runs of the same key: exactly one succeeds", async () => {
    const results = await Promise.allSettled([1, 2].map(() => withTx((tx) => runOnce(tx, "test-job", "race", null, async () => ({ n: 1 })))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof JobAlreadyRunError)).toHaveLength(1);
  });
});
