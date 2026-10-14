import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, getPool, withTx } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { businessToday, setClock } from "@/lib/dates";
import { auditLog } from "@/modules/audit/schema";
import { approveDvAction, cancelDvAction, releaseDvAction } from "@/modules/cashiering/actions";
import { dvLines } from "@/modules/cashiering/schema";
import { accountBalance, accountIdFor, trialBalance } from "@/modules/ledger/service";
import { getLoan } from "@/modules/loans/servicing";
import { accountBalance as savingsBalance } from "@/modules/savings/service";
import { shareTransactions } from "@/modules/share/schema";
import { ROLE_PERMISSIONS } from "@/modules/auth/permissions";
import { getSetting, updateSetting } from "@/modules/settings/service";
import { surplusWorkbook } from "@/modules/surplus/export";
import { approveAllocationAction, distributeAllocationAction, draftAllocationAction, postAllocationAction, remitCetfAction, setElectionAction } from "@/modules/surplus/actions";
import { allocationLines, approveAllocation, cetfReport, getAllocation, memberEntitlements, memberShares } from "@/modules/surplus/service";
import { waterBillsPaid } from "@/modules/water/reports";
import { waterCustomers } from "@/modules/water/schema";
import { makeUser } from "../helpers/phase01";
import { applicant, createApplicantAs } from "../helpers/phase02";
import { P, seedLedger } from "../helpers/phase03";
import { activeAccount } from "../helpers/phase06";
import { at as waterAt, billMonth, payWater, setupCollections } from "../helpers/phase07";
import { openSessionAs } from "../helpers/phase04";
import { on, openSavings, postedAllocation, surplusFixture, surplusPeople } from "../helpers/phase15";

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

describe("T15.3 each member's ASM and patronage, and their ISC and PR", () => {
  const FY = { year: 2026, startDate: "2026-01-01", endDate: "2026-12-31" };
  const ALL = { loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: false };

  it("ASM, loan interest paid and net store purchases of each eligible member; the pools shared to the centavo", async () => {
    const f = await surplusFixture(P(20000));
    const ents = await memberEntitlements(FY, ALL);
    expect(ents).toEqual([
      { memberId: f.a, asm: P(12000), loanInterest: 0n, store: P(10000), water: 0n, patronage: P(10000) },
      { memberId: f.b, asm: P(9000), loanInterest: P(150), store: P(29850), water: 0n, patronage: P(30000) },
      { memberId: f.c, asm: P(77000), loanInterest: 0n, store: P(2000), water: 0n, patronage: P(2000) },
    ]);
    const shares = memberShares(2026, { iscPool: P(9800), prPool: P(4200) }, ents);
    expect([shares.iscRate, shares.prRate]).toEqual(["0.1", "0.1"]);
    expect(shares.lines.map((l) => [l.isc, l.pr, l.gross])).toEqual([
      [P(1200), P(1000), P(2200)],
      [P(900), P(3000), P(3900)],
      [P(7700), P(200), P(7900)],
    ]);
    // When only loan interest counts, B alone shares the patronage refund.
    const interestOnly = await memberEntitlements(FY, { ...ALL, netStorePurchases: false });
    expect(memberShares(2026, { iscPool: 0n, prPool: P(4200) }, interestOnly).lines.map((l) => [l.memberId, l.pr])).toEqual([[f.b, P(4200)]]);
    expect(() => memberShares(2026, { iscPool: P(1), prPool: 0n }, [])).toThrow("No member had share capital in 2026 to share the interest on share capital");
    expect(() => memberShares(2026, { iscPool: 0n, prPool: P(1) }, [])).toThrow("No member had patronage in 2026 to share the patronage refund");
  });

  it("water bills a member paid count when the basis says so: what was applied to bills in the year", async () => {
    const u = await setupCollections(); // Oct 7, 2026
    const mine = await activeAccount({ clerk: u.clerk.id, manager: u.manager.id, routeId: u.routeId, initialReading: 0, kind: "MEMBER" });
    const other = await activeAccount({ clerk: u.clerk.id, manager: u.manager.id, routeId: u.routeId, initialReading: 0 });
    await billMonth(u.clerk.id, u.zoneId, "2026-10", [
      [mine.accountId, 18],
      [other.accountId, 18],
    ]);
    setClock(() => waterAt("2026-11-05"));
    expect((await payWater(mine.customer.id, mine.accountId, "300.00")).ok).toBe(true);
    expect((await payWater(other.customer.id, other.accountId, "300.00")).ok).toBe(true);
    const [c] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, mine.customer.id));
    expect(await waterBillsPaid(c!.memberId!, "2026-01-01", "2026-12-31")).toBe(P(300));
    expect(await waterBillsPaid(c!.memberId!, "2027-01-01", "2027-12-31")).toBe(0n);
    const ents = await memberEntitlements(FY, { ...ALL, waterBillsPaidByMembers: true });
    expect(ents.find((e) => e.memberId === c!.memberId)).toMatchObject({ water: P(300), patronage: P(300) });
    expect((await memberEntitlements(FY, ALL)).find((e) => e.memberId === c!.memberId)).toBeUndefined();
  });
});

describe("T15.4 the workflow: draft → approve → post → distribute", () => {
  const book = () => surplusPeople().book;
  const lineOf = async (allocationId: string, memberId: string) => (await allocationLines(allocationId)).find((l) => l.memberId === memberId)!;
  const elect = (lineId: string, savings: string, capitalize: string, cash: string) => runAs(book(), () => setElectionAction({ lineId, savings, capitalize, cash }));
  const net = async (key: string) => (await accountBalance(await accountIdFor(key), businessToday())).net;

  it("a draft needs the year closed with a net surplus; the GA's percentages or the settings; a re-draft recomputes and keeps elections; the steps go in order", async () => {
    const f = await surplusFixture(P(20000));
    on("2027-03-01");
    expect(await runAs(book(), () => draftAllocationAction({ year: 2027 }))).toEqual({ ok: false, error: "Close fiscal year 2027 first (the year-end close, on Period close)" });
    expect(await runAs(book(), () => draftAllocationAction({ year: 2026, reserve: "8" }))).toEqual({ ok: false, error: "The reserve fund must be at least 10% of net surplus (8.00% entered)" });
    const d = await runAs(book(), () => draftAllocationAction({ year: 2026, reserve: "12", optional: "5", iscShare: "60", prShare: "40" }));
    if (!d.ok) throw new Error(d.error);
    expect(await getAllocation(d.data.id)).toMatchObject({ status: "DRAFT", reservePct: "0.12", optionalPct: "0.05", reserve: P(2400), etfLocal: P(1000), cetf: P(1000), cdf: P(600), optional: P(1000), remaining: P(14000), iscPool: P(8400), prPool: P(5600) });
    const a = await lineOf(d.data.id, f.a);
    expect(await elect(a.id, "50", "30", "0")).toEqual({ ok: false, error: "The payout parts add up to 100%" });
    expect((await elect(a.id, "0", "100", "0")).ok).toBe(true);
    // Re-drafted with the settings: amounts recomputed, A's election kept, the others on the default (savings).
    expect((await runAs(book(), () => draftAllocationAction({ year: 2026 }))).ok).toBe(true);
    expect(await lineOf(d.data.id, f.a)).toMatchObject({ isc: P(1200), pr: P(1000), electSavings: 0, electCapitalize: 10000, electCash: 0 });
    expect(await lineOf(d.data.id, f.c)).toMatchObject({ electSavings: 10000, electCapitalize: 0, electCash: 0 });
    // Order and separation of duties.
    expect(await runAs(book(), () => postAllocationAction({ allocationId: d.data.id, gaResolutionNo: "GA-1" }))).toEqual({ ok: false, error: "Fiscal year 2026's allocation isn't approved yet" });
    expect(await runAs(book(), () => distributeAllocationAction({ allocationId: d.data.id }))).toEqual({ ok: false, error: "Post fiscal year 2026's allocation first" });
    await expect(withTx((tx) => approveAllocation(tx, { allocationId: d.data.id }, book()))).rejects.toThrow("The one who prepared the allocation can't approve it");
    expect((await runAs(surplusPeople().manager, () => approveAllocationAction({ allocationId: d.data.id }))).ok).toBe(true);
    expect(await runAs(book(), () => draftAllocationAction({ year: 2026 }))).toEqual({ ok: false, error: "Fiscal year 2026's allocation is already approved" });
    const [audited] = await getDb().select().from(auditLog).where(eq(auditLog.action, "surplus.redraft"));
    expect(audited?.userId).toBe(book());
  });

  it("distribution: withholding tax, then arrears; savings, share capital (ISC/PR capitalized) and cash by DV, drawn from ISC payable first; the payables are empty once the DVs are released", async () => {
    const f = await surplusFixture(P(20000));
    await withTx((tx) => updateSetting(tx, "surplus.isc_pr_wtax_rate", "0.1", surplusPeople().manager));
    on("2027-03-01");
    const id = await postedAllocation(2026);
    const [a, b] = [await lineOf(id, f.a), await lineOf(id, f.b)];
    expect((await elect(a.id, "0", "50", "50")).ok).toBe(true);
    expect((await elect(b.id, "0", "0", "100")).ok).toBe(true);
    // C stays on the default (savings) but has no savings account yet.
    expect(await runAs(book(), () => distributeAllocationAction({ allocationId: id }))).toMatchObject({ ok: false, error: expect.stringMatching(/^These members chose savings but have no savings account; open one or change their payout: M-\d+ .*Charlie$/) });
    const savingsC = await openSavings(f.c);
    expect(await runAs(book(), () => distributeAllocationAction({ allocationId: id }))).toEqual({ ok: true, data: { members: 3 } });
    // A: 2,200 − 10% (220) = 1,980 → 990 to share capital (980 ISC + 10 PR), 990 in cash (PR).
    expect(await lineOf(id, f.a)).toMatchObject({ wtax: P(220), arrearsOffset: 0n, net: P(1980), payoutCapitalize: P(990), payoutCash: P(990), payoutSavings: 0n });
    const capital = await getDb().select().from(shareTransactions).where(eq(shareTransactions.memberId, f.a));
    expect(capital.filter((t) => t.type === "ISC_CAPITALIZED" || t.type === "PR_CAPITALIZED").map((t) => [t.type, t.amount])).toEqual([
      ["ISC_CAPITALIZED", P(980)],
      ["PR_CAPITALIZED", P(10)],
    ]);
    // B: 3,900 − 390 − 500 arrears = 3,010 in cash (10 ISC + 3,000 PR).
    expect(await lineOf(id, f.b)).toMatchObject({ wtax: P(390), arrearsOffset: P(500), net: P(3010), payoutCash: P(3010) });
    // C: 7,900 − 790 = 7,110 to savings.
    expect(await lineOf(id, f.c)).toMatchObject({ wtax: P(790), net: P(7110), payoutSavings: P(7110), savingsAccountId: savingsC });
    expect(await savingsBalance(savingsC)).toBe(P(7110));
    expect(-(await net("withholding_tax_payable"))).toBe(P(1400));
    const dvOf = async (memberId: string) => {
      const line = await lineOf(id, memberId);
      return getDb().select().from(dvLines).where(eq(dvLines.dvId, line.dvId!));
    };
    const [iscPayable, prPayable] = [await accountIdFor("isc_payable"), await accountIdFor("patronage_refund_payable")];
    expect((await dvOf(f.a)).map((l) => [l.accountId, l.amount])).toEqual([[prPayable, P(990)]]);
    expect((await dvOf(f.b)).map((l) => [l.accountId, l.amount])).toEqual([
      [iscPayable, P(10)],
      [prPayable, P(3000)],
    ]);
    expect([-(await net("isc_payable")), -(await net("patronage_refund_payable"))]).toEqual([P(10), P(3990)]);
    // The manager approves the DVs; a teller releases them: nothing is left payable.
    const teller = surplusPeople().teller;
    await openSessionAs(teller, "10,000.00");
    for (const memberId of [f.a, f.b]) {
      const dvId = (await lineOf(id, memberId)).dvId!;
      expect((await runAs(surplusPeople().manager, () => approveDvAction({ dvId }))).ok).toBe(true);
      expect((await runAs(teller, () => releaseDvAction({ dvId }))).ok).toBe(true);
    }
    expect([await net("isc_payable"), await net("patronage_refund_payable")]).toEqual([0n, 0n]);
    expect(await getAllocation(id)).toMatchObject({ status: "DISTRIBUTED" });
    expect(await runAs(book(), () => distributeAllocationAction({ allocationId: id }))).toEqual({ ok: false, error: "Fiscal year 2026's allocation is already distributed" });
    expect(await elect(a.id, "100", "0", "0")).toEqual({ ok: false, error: "This member's ISC and patronage refund were already paid out" });
    expect((await trialBalance(businessToday())).balanced).toBe(true);
  });

  it("arrears larger than the ISC and PR take all of it; nothing is left to pay out", async () => {
    const f = await surplusFixture(P(20000));
    on("2027-06-01"); // installments 1–4 are past due: ₱500.00 + 3 × ₱2,650.00 = ₱8,450.00
    const id = await postedAllocation(2026);
    const b = await lineOf(id, f.b);
    expect((await elect(b.id, "0", "0", "100")).ok).toBe(true);
    await openSavings(f.a);
    await openSavings(f.c);
    expect((await runAs(book(), () => distributeAllocationAction({ allocationId: id }))).ok).toBe(true);
    expect(await lineOf(id, f.b)).toMatchObject({ arrearsOffset: P(3900), net: 0n, payoutCash: 0n, dvId: null });
    expect((await getLoan(f.bLoanId))?.payments.at(-1)).toMatchObject({ kind: "OFFSET", amount: P(3900) });
  });
});

describe("T15.5 the CETF payable and its remittance", () => {
  it("each posted year's CETF: remitted by DV (manager approves, released by check), pending until released, never more than is left; a cancelled DV frees its amount", async () => {
    await surplusFixture(P(20000));
    on("2027-03-01");
    const book = surplusPeople().book;
    const d = await runAs(book, () => draftAllocationAction({ year: 2026 }));
    if (!d.ok) throw new Error(d.error);
    const remit = (amount: string) => runAs(book, () => remitCetfAction({ allocationId: d.data.id, amount, payee: "Federation of Rizal Cooperatives", mode: "CHECK", checkNo: "000123" }));
    expect(await remit("100.00")).toEqual({ ok: false, error: "Post fiscal year 2026's allocation first" });
    expect((await runAs(surplusPeople().manager, () => approveAllocationAction({ allocationId: d.data.id }))).ok).toBe(true);
    expect((await runAs(book, () => postAllocationAction({ allocationId: d.data.id, gaResolutionNo: "GA-2027-07" }))).ok).toBe(true);
    expect(await cetfReport()).toEqual([{ allocationId: d.data.id, fiscalYear: 2026, cetf: P(1000), remitted: 0n, pending: 0n, toRemit: P(1000) }]);
    await expect(runAs(surplusPeople().teller, () => remitCetfAction({ allocationId: d.data.id, amount: "1.00", payee: "X", mode: "CASH", checkNo: null }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await runAs(book, () => remitCetfAction({ allocationId: d.data.id, amount: "1.00", payee: " ", mode: "CASH", checkNo: null }))).toEqual({ ok: false, error: "Enter the federation or union the CETF is remitted to" });
    const first = await remit("600.00");
    if (!first.ok) throw new Error(first.error);
    expect(await remit("500.00")).toEqual({ ok: false, error: "Only ₱400.00 of fiscal year 2026's CETF is left to remit" });
    const second = await remit("400.00");
    if (!second.ok) throw new Error(second.error);
    expect((await cetfReport())[0]).toMatchObject({ remitted: 0n, pending: P(1000), toRemit: 0n });
    // The second DV is cancelled; the first is approved and released (by check, no teller drawer).
    expect((await runAs(surplusPeople().manager, () => cancelDvAction({ dvId: second.data.dvId, reason: "Wrong amount" }))).ok).toBe(true);
    expect((await runAs(surplusPeople().manager, () => approveDvAction({ dvId: first.data.dvId }))).ok).toBe(true);
    expect((await runAs(surplusPeople().teller, () => releaseDvAction({ dvId: first.data.dvId }))).ok).toBe(true);
    expect((await cetfReport())[0]).toMatchObject({ remitted: P(600), pending: 0n, toRemit: P(400) });
    expect(-(await accountBalance(await accountIdFor("cetf_payable"), "2027-03-01")).net).toBe(P(400));
    const [dvLine] = await getDb().select().from(dvLines).where(eq(dvLines.dvId, first.data.dvId));
    expect(dvLine).toMatchObject({ accountId: await accountIdFor("cetf_payable"), amount: P(600), memberId: null });
  });
});

describe("T15.6 the workbook for the General Assembly", () => {
  it("the allocation summary and the per-member list with totals", async () => {
    const f = await surplusFixture(P(20000));
    on("2027-03-01");
    const id = await postedAllocation(2026);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await surplusWorkbook(id, "PCMPC")) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Members"]);
    const summary = wb.getWorksheet("Summary")!;
    const rows = (ws: ExcelJS.Worksheet) => {
      const out: unknown[][] = [];
      ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
      return out;
    };
    expect(rows(summary).slice(1, 3)).toEqual([["Allocation of net surplus, fiscal year 2026"], ["Posted · GA resolution GA-2027-07"]]);
    expect(rows(summary).slice(4)).toEqual([
      ["Net surplus", "", 20000],
      ["Reserve fund", "10.00%", 2000],
      ["Education and training fund (local)", "10.00% ÷ 2", 1000],
      ["CETF (to the federation/union)", "10.00% ÷ 2", 1000],
      ["Community development fund", "3.00%", 600],
      ["Optional fund", "7.00%", 1400],
      ["Remaining for ISC and patronage refund", "", 14000],
      ["Interest on share capital", "70.00% · 10.00% of ASM", 9800],
      ["Patronage refund", "30.00% · 10.00% of patronage", 4200],
    ]);
    const members = rows(wb.getWorksheet("Members")!);
    const memberNo = (await allocationLines(id)).find((l) => l.memberId === f.a)!.memberNo;
    expect(members.find((r) => r[0] === memberNo)?.slice(2)).toEqual([12000, 1200, 0, 10000, 0, 10000, 1000, 2200, 0, 0, 2200, 0, 0, 0]);
    expect(members.at(-1)?.slice(0, 2)).toEqual(["Total", "3 members"]);
    expect(members.at(-1)?.slice(3, 4)).toEqual([9800]);
  });
});
