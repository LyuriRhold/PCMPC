import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { accountSegments, assetClasses, fsLineAccounts, fsLines } from "@/modules/accounting/schema";
import { seedFs } from "@/modules/accounting/seed";
import { accounts } from "@/modules/ledger/schema";
import { fsPeople, setupFs } from "../helpers/phase14";

beforeEach(async () => {
  await setupFs();
});
afterEach(() => setClock(null));

describe("T14.1 schema and the statement-line seed", () => {
  it("every postable account of the provisional chart is on one statement line of the right statement; revenue and expense accounts have a segment", async () => {
    const postable = await getDb().select().from(accounts).where(eq(accounts.isPostable, true));
    const maps = await getDb().select({ accountId: fsLineAccounts.accountId, statement: fsLines.statement, code: fsLines.code }).from(fsLineAccounts).innerJoin(fsLines, eq(fsLines.id, fsLineAccounts.fsLineId));
    const lineOf = new Map(maps.map((m) => [m.accountId, m]));
    for (const a of postable) {
      const m = lineOf.get(a.id);
      expect(m, `${a.code} ${a.name}`).toBeDefined();
      expect(m!.statement, a.code).toBe(["ASSET", "LIABILITY", "EQUITY"].includes(a.type) ? "SFC" : "SOO");
    }
    const byCode = (code: string) => lineOf.get(postable.find((a) => a.code === code)!.id)?.code;
    expect([byCode("11110"), byCode("11270"), byCode("11290"), byCode("12135"), byCode("21220"), byCode("43120"), byCode("44140"), byCode("53140")]).toEqual([
      "CASH",
      "SHARE_CAPITAL",
      "LOANS",
      "PPE_DEPRECIATION",
      "OTHER_PAYABLES",
      "SALES",
      "OTHER_INCOME",
      "OPERATING_EXPENSES",
    ]);
    const segs = await getDb().select({ code: accounts.code, segment: accountSegments.segmentCode }).from(accountSegments).innerJoin(accounts, eq(accounts.id, accountSegments.accountId));
    const seg = new Map(segs.map((s) => [s.code, s.segment]));
    expect(["41110", "52110", "44140", "42110", "43110", "51110", "53120"].map((c) => seg.get(c))).toEqual(["CREDIT", "CREDIT", "CREDIT", "WATER", "CONSUMER", "CONSUMER", "CONSUMER"]);
    expect(seg.get("53140")).toBeUndefined();
    expect((await getDb().select().from(assetClasses)).map((c) => c.code).sort()).toEqual(["BUILDING", "FURNITURE", "OFFICE_EQUIPMENT", "TRANSPORTATION", "WATER_SYSTEM"]);
  });

  it("the seed is idempotent and never moves an account already mapped", async () => {
    const before = await getDb().select().from(fsLineAccounts);
    const [other] = await getDb().select().from(fsLines).where(eq(fsLines.code, "OTHER_ASSETS"));
    const [cash] = await getDb().select().from(accounts).where(eq(accounts.code, "11130"));
    await getDb().update(fsLineAccounts).set({ fsLineId: other!.id }).where(eq(fsLineAccounts.accountId, cash!.id));
    await withTx((tx) => seedFs(tx));
    const after = await getDb().select().from(fsLineAccounts);
    expect(after).toHaveLength(before.length);
    expect(after.find((m) => m.accountId === cash!.id)?.fsLineId).toBe(other!.id);
  });

  it("closing records are never changed; fixed assets keep their terms", async () => {
    await getPool().query("INSERT INTO close_checklists (period, item, status, by) VALUES ('2026-01', 'x', 'PASS', $1)", [fsPeople().admin]);
    await expect(getPool().query("UPDATE close_checklists SET status = 'FAIL'")).rejects.toThrow(/immutable/);
    await expect(getPool().query("DELETE FROM close_checklists")).rejects.toThrow(/immutable/);
    await expect(getPool().query("INSERT INTO fixed_assets (tag, description, class_code, acquisition_date, cost, salvage, life_months) VALUES ('T1', 'x', 'OFFICE_EQUIPMENT', '2026-12-01', 100, 0, 0)")).rejects.toThrow(/fixed_assets_amounts_chk/);
  });
});
