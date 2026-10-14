import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getPool } from "@/db/client";
import { setClock } from "@/lib/dates";
import { ROLE_PERMISSIONS } from "@/modules/auth/permissions";
import { getSetting } from "@/modules/settings/service";
import { makeUser } from "../helpers/phase01";
import { applicant, createApplicantAs } from "../helpers/phase02";
import { seedLedger } from "../helpers/phase03";

afterEach(() => setClock(null));

/** An allocation row as SQL would write it (₱100.00 net surplus: 10 / 5 / 5 / 3 / 7, remaining 70 → 49 / 21). */
async function rawAllocation(by: string, overrides: Record<string, string | number | null> = {}) {
  const row: Record<string, string | number | null> = {
    fiscal_year: 2026,
    net_surplus: 10000,
    reserve_pct: "0.10",
    etf_pct: "0.10",
    cdf_pct: "0.03",
    optional_pct: "0.07",
    isc_share: "0.70",
    pr_share: "0.30",
    pr_basis: JSON.stringify({ loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: false }),
    wtax_rate: "0",
    offset_arrears: "true",
    reserve: 1000,
    etf_local: 500,
    cetf: 500,
    cdf: 300,
    optional: 700,
    remaining: 7000,
    isc_pool: 4900,
    pr_pool: 2100,
    isc_rate: "0.1",
    pr_rate: "0.1",
    prepared_by: by,
    ...overrides,
  };
  const cols = Object.keys(row);
  const r = await getPool().query(`INSERT INTO surplus_allocations (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, Object.values(row));
  return r.rows[0].id as string;
}

describe("T15.1 schema, permissions and settings", () => {
  it("the bookkeeper prepares and the manager approves; the default payout is savings, a member's election overrides it", async () => {
    expect(ROLE_PERMISSIONS.BOOKKEEPER).toContain("surplus.prepare");
    expect(ROLE_PERMISSIONS.BOOKKEEPER).not.toContain("surplus.approve");
    expect(ROLE_PERMISSIONS.MANAGER).toContain("surplus.approve");
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain("surplus.prepare");
    await seedLedger();
    expect(await getSetting("surplus.default_payout")).toEqual({ savings: "1", capitalize: "0", cash: "0" });
  });

  it("the split adds up; one allocation a year; the approver isn't the preparer; a posted allocation only gets its distribution; never deleted", async () => {
    await seedLedger();
    const book = (await makeUser("BOOKKEEPER", "book1")).id;
    const mgr = (await makeUser("MANAGER", "mgr1")).id;
    await expect(rawAllocation(book, { reserve: 1001 })).rejects.toThrow(/surplus_allocations_split_chk/);
    await expect(rawAllocation(book, { isc_pool: 5000 })).rejects.toThrow(/surplus_allocations_split_chk/);
    const id = await rawAllocation(book);
    await expect(rawAllocation(book)).rejects.toThrow(/unique/);
    await expect(getPool().query("UPDATE surplus_allocations SET approved_by = prepared_by WHERE id = $1", [id])).rejects.toThrow(/surplus_allocations_sod_chk/);
    await expect(getPool().query("UPDATE surplus_allocations SET status = 'POSTED', approved_by = $2 WHERE id = $1", [id, mgr])).rejects.toThrow(/surplus_allocations_posted_chk/);
    // A line: gross = ISC + PR; the election adds up to 100%.
    const memberId = await createApplicantAs(mgr, applicant({ lastName: "Line", firstName: "Member", tin: null, validIdNo: "ID-SL1" }));
    const line = (o: string) =>
      getPool().query(
        `INSERT INTO surplus_member_lines (allocation_id, member_id, asm, isc, patronage_loan_interest, patronage_store, patronage_water, patronage_total, pr, gross, elect_savings, elect_capitalize, elect_cash, net) VALUES ($1, $2, 100, 49, 0, 10, 0, 10, 21, ${o}) RETURNING id`,
        [id, memberId],
      );
    await expect(line("71, 10000, 0, 0, 70")).rejects.toThrow(/surplus_member_lines_amounts_chk/);
    await expect(line("70, 5000, 0, 0, 70")).rejects.toThrow(/surplus_member_lines_election_chk/);
    const lineId = (await line("70, 10000, 0, 0, 70")).rows[0].id as string;
    await expect(getPool().query("DELETE FROM surplus_allocations WHERE id = $1", [id])).rejects.toThrow(/can't be deleted/);
    // Approved: member lines keep their ISC and PR and aren't removed; the election may still change.
    await getPool().query("UPDATE surplus_allocations SET status = 'APPROVED', approved_by = $2 WHERE id = $1", [id, mgr]);
    await expect(getPool().query("UPDATE surplus_member_lines SET isc = 50, gross = 71, net = 71 WHERE id = $1", [lineId])).rejects.toThrow(/only while the allocation is a draft/);
    await expect(getPool().query("DELETE FROM surplus_member_lines WHERE id = $1", [lineId])).rejects.toThrow(/only from a draft allocation/);
    await getPool().query("UPDATE surplus_member_lines SET elect_savings = 5000, elect_cash = 5000 WHERE id = $1", [lineId]);
  });
});
