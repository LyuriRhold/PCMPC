import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool } from "@/db/client";
import { setClock } from "@/lib/dates";
import { posShifts } from "@/modules/store/schema";
import { P } from "../helpers/phase03";
import { setupStore, storePeople } from "../helpers/phase12";

beforeEach(async () => {
  await setupStore();
});
afterEach(() => setClock(null));

describe("T13.1 schema and data rules", () => {
  it("one open shift per cashier; a shift keeps its cashier, date and opening fund and closes once", async () => {
    const { clerk, manager } = storePeople();
    const [s] = await getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-07", openingFund: P(1000) }).returning();
    await expect(getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-07", openingFund: P(500) })).rejects.toThrow();
    const pool = getPool();
    await expect(pool.query("UPDATE pos_shifts SET opening_fund = 1 WHERE id = $1", [s!.id])).rejects.toThrow(/only the closing and verification are recorded/);
    await expect(pool.query("UPDATE pos_shifts SET status = 'VERIFIED' WHERE id = $1", [s!.id])).rejects.toThrow(/closed first/);
    await expect(pool.query("DELETE FROM pos_shifts WHERE id = $1", [s!.id])).rejects.toThrow(/can't be deleted/);
    await pool.query("UPDATE pos_shifts SET status = 'CLOSED', counted_cash = 100000, expected_cash = 100000, variance = 0 WHERE id = $1", [s!.id]);
    await expect(pool.query("UPDATE pos_shifts SET counted_cash = 5 WHERE id = $1", [s!.id])).rejects.toThrow(/CLOSED POS shift can't change/);
    await expect(pool.query("UPDATE pos_shifts SET status = 'VERIFIED', verified_by = cashier_id WHERE id = $1", [s!.id])).rejects.toThrow(/pos_shifts_sod_chk/);
    await pool.query("UPDATE pos_shifts SET status = 'VERIFIED', verified_by = $2 WHERE id = $1", [s!.id, manager]);
    // A new shift can open once the other is closed.
    await getDb().insert(posShifts).values({ cashierId: clerk, businessDate: "2026-10-08", openingFund: P(500) });
  });
});
