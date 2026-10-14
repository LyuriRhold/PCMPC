import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb } from "@/db/client";
import { ForbiddenError, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { disbursementVouchers, dvLines } from "@/modules/cashiering/schema";
import { journalLines } from "@/modules/ledger/schema";
import { accountBalance, accountIdFor } from "@/modules/ledger/service";
import { getLoan } from "@/modules/loans/servicing";
import { accountBalance as savingsBalance } from "@/modules/savings/service";
import { shareBalance } from "@/modules/share/service";
import { approveAllocationAction, distributeAllocationAction, draftAllocationAction, postAllocationAction, setElectionAction } from "@/modules/surplus/actions";
import { patronageOf, ratePercent, sharePool, splitSurplus, type SurplusPercents } from "@/modules/surplus/engine";
import { surplusAllocations } from "@/modules/surplus/schema";
import { allocationLines } from "@/modules/surplus/service";
import { P } from "../helpers/phase03";
import { on, openSavings, postedAllocation, surplusFixture, surplusPeople } from "../helpers/phase15";

afterEach(() => setClock(null));

/** The DOMAIN defaults: 10/10/3/7 of net surplus; 70% ISC / 30% PR of what remains. */
const DEFAULTS: SurplusPercents = { reserve: "0.10", etf: "0.10", cdf: "0.03", optional: "0.07", iscShare: "0.70", prShare: "0.30" };

describe("Phase 15 acceptance: the allocation engine", () => {
  it("A15.1 net surplus ₱1,000,000.00 with 10/10/3/7 → reserve ₱100,000.00; ETF ₱100,000.00 (local ₱50,000.00, CETF ₱50,000.00); CDF ₱30,000.00; optional ₱70,000.00; remaining ₱700,000.00", () => {
    const s = splitSurplus(P(1000000), DEFAULTS);
    expect(s).toMatchObject({ netSurplus: P(1000000), reserve: P(100000), etf: P(100000), etfLocal: P(50000), cetf: P(50000), cdf: P(30000), optional: P(70000), remaining: P(700000) });
  });

  it("A15.2 remaining ₱700,000.00 with ISC 70% / PR 30% → ISC pool ₱490,000.00; PR pool ₱210,000.00", () => {
    const s = splitSurplus(P(1000000), DEFAULTS);
    expect([s.remaining, s.iscPool, s.prPool]).toEqual([P(700000), P(490000), P(210000)]);
  });

  it("A15.3 reserve 8% / ETF 12% / PR 20% → each blocked with a specific message", () => {
    expect(() => splitSurplus(P(1000000), { ...DEFAULTS, reserve: "0.08" })).toThrow("The reserve fund must be at least 10% of net surplus (8.00% entered)");
    expect(() => splitSurplus(P(1000000), { ...DEFAULTS, etf: "0.12" })).toThrow("The education and training fund can be at most 10% of net surplus (12.00% entered)");
    expect(() => splitSurplus(P(1000000), { ...DEFAULTS, iscShare: "0.80", prShare: "0.20" })).toThrow("The patronage refund must be at least 30% of what remains after the funds (20.00% entered)");
  });

  it("A15.4 ISC pool ₱2,100.00; ASM A ₱12,000.00, B ₱9,000.00 → rate 10.00%; A ₱1,200.00; B ₱900.00", () => {
    const isc = sharePool(P(2100), [P(12000), P(9000)]);
    expect(ratePercent(isc.rate)).toBe("10.00%");
    expect(isc.amounts).toEqual([P(1200), P(900)]);
  });

  it("A15.5 PR pool ₱4,000.00; patronage A ₱10,000.00 (₱3,000 interest + ₱7,000 store), B ₱30,000.00 → rate 10.00%; A ₱1,000.00; B ₱3,000.00", () => {
    const basis = { loanInterestPaid: true, netStorePurchases: true, waterBillsPaidByMembers: false };
    const a = patronageOf({ loanInterest: P(3000), store: P(7000), water: 0n }, basis);
    expect(a).toBe(P(10000));
    const pr = sharePool(P(4000), [a, P(30000)]);
    expect(ratePercent(pr.rate)).toBe("10.00%");
    expect(pr.amounts).toEqual([P(1000), P(3000)]);
  });

  it("A15.6 ISC pool ₱100.00, three members with equal ASM → ₱33.34, ₱33.33, ₱33.33 (sum ₱100.00)", () => {
    const isc = sharePool(P(100), [P(5000), P(5000), P(5000)]);
    expect(isc.amounts).toEqual([P(33, 34), P(33, 33), P(33, 33)]);
    expect(isc.amounts.reduce((s, x) => s + x, 0n)).toBe(P(100));
  });
});

const bal = async (key: string) => (await accountBalance(await accountIdFor(key), "2027-03-01")).net;

describe("Phase 15 acceptance: posting the A15.1 allocation", () => {
  beforeEach(async () => {
    await surplusFixture(P(1000000));
    on("2027-03-01");
  });

  it("A15.7 post the A15.1 allocation → balanced JE; Undivided Net Surplus balance = ₱0.00; fund accounts equal A15.1", async () => {
    const id = await postedAllocation(2026);
    const [alloc] = await getDb().select().from(surplusAllocations).where(eq(surplusAllocations.id, id));
    expect(alloc).toMatchObject({ fiscalYear: 2026, status: "POSTED", netSurplus: P(1000000), reserve: P(100000), etfLocal: P(50000), cetf: P(50000), cdf: P(30000), optional: P(70000), remaining: P(700000), iscPool: P(490000), prPool: P(210000) });
    const lines = await getDb().select().from(journalLines).where(eq(journalLines.jeId, alloc!.jeId!));
    const dr = lines.reduce((s, l) => s + l.debit, 0n);
    const cr = lines.reduce((s, l) => s + l.credit, 0n);
    expect([dr, cr]).toEqual([P(1000000), P(1000000)]);
    expect(await bal("undivided_net_surplus")).toBe(0n);
    const funds = ["reserve_fund", "education_training_fund", "cetf_payable", "community_development_fund", "optional_fund", "isc_payable", "patronage_refund_payable"];
    expect(await Promise.all(funds.map(async (k) => -(await bal(k))))).toEqual([P(100000), P(50000), P(50000), P(30000), P(70000), P(490000), P(210000)]);
  });
});

describe("Phase 15 acceptance: ISC and PR per member, distribution, controls (net surplus ₱20,000.00)", () => {
  let f: Awaited<ReturnType<typeof surplusFixture>>;
  beforeEach(async () => {
    // Pools: remaining ₱14,000.00 → ISC ₱9,800.00 over Σ ASM ₱98,000.00 and PR ₱4,200.00 over Σ patronage ₱42,000.00 (both 10.00%).
    f = await surplusFixture(P(20000));
    on("2027-03-01");
  });
  const book = () => surplusPeople().book;

  it("A15.8 member A (₱2,200.00 gross) elects 50% capitalize / 50% savings → paid-up +₱1,100.00; savings +₱1,100.00", async () => {
    const id = await postedAllocation(2026);
    const lines = await allocationLines(id);
    const a = lines.find((l) => l.memberId === f.a)!;
    const b = lines.find((l) => l.memberId === f.b)!;
    expect(a).toMatchObject({ asm: P(12000), isc: P(1200), patronageStore: P(10000), patronageTotal: P(10000), pr: P(1000), gross: P(2200) });
    const savingsA = await openSavings(f.a);
    await openSavings(f.c);
    expect((await runAs(book(), () => setElectionAction({ lineId: a.id, savings: "50", capitalize: "50", cash: "0" }))).ok).toBe(true);
    expect((await runAs(book(), () => setElectionAction({ lineId: b.id, savings: "0", capitalize: "0", cash: "100" }))).ok).toBe(true);
    const before = { paidUp: (await shareBalance(f.a)).paidUp, savings: await savingsBalance(savingsA) };
    const r = await runAs(book(), () => distributeAllocationAction({ allocationId: id }));
    if (!r.ok) throw new Error(r.error);
    expect((await shareBalance(f.a)).paidUp - before.paidUp).toBe(P(1100));
    expect((await savingsBalance(savingsA)) - before.savings).toBe(P(1100));
    expect((await allocationLines(id)).find((l) => l.memberId === f.a)).toMatchObject({ net: P(2200), payoutCapitalize: P(1100), payoutSavings: P(1100), payoutCash: 0n });
  });

  it("A15.9 member B has past-due arrears ₱500.00, offset ON → ₱500.00 applied as a loan payment first; net payout ₱3,400.00 (900 + 3,000 − 500)", async () => {
    const id = await postedAllocation(2026);
    const b = (await allocationLines(id)).find((l) => l.memberId === f.b)!;
    expect(b).toMatchObject({ asm: P(9000), isc: P(900), patronageLoanInterest: P(150), patronageStore: P(29850), patronageTotal: P(30000), pr: P(3000), gross: P(3900) });
    await openSavings(f.a);
    await openSavings(f.c);
    expect((await runAs(book(), () => setElectionAction({ lineId: b.id, savings: "0", capitalize: "0", cash: "100" }))).ok).toBe(true);
    const r = await runAs(book(), () => distributeAllocationAction({ allocationId: id }));
    if (!r.ok) throw new Error(r.error);
    const after = (await allocationLines(id)).find((l) => l.memberId === f.b)!;
    expect(after).toMatchObject({ arrearsOffset: P(500), net: P(3400), payoutCash: P(3400), payoutSavings: 0n, payoutCapitalize: 0n });
    const loan = await getLoan(f.bLoanId);
    expect(loan?.schedule[0]).toMatchObject({ principalPaid: P(2500), status: "PAID" });
    expect(loan?.payments.at(-1)).toMatchObject({ kind: "OFFSET", amount: P(500), principalPart: P(500) });
    // The cash goes out by a disbursement voucher for B's ₱3,400.00.
    const [dv] = await getDb().select().from(disbursementVouchers).where(eq(disbursementVouchers.id, after.dvId!));
    expect(dv).toMatchObject({ amount: P(3400), status: "DRAFT", mode: "CASH" });
    const dvl = await getDb().select().from(dvLines).where(eq(dvLines.dvId, dv!.id));
    expect(dvl.every((l) => l.memberId === f.b)).toBe(true);
  });

  it("A15.10 approve as the preparer / post without a GA resolution / re-run FY 2026 after POSTED → Forbidden / rejected / rejected", async () => {
    const d = await runAs(book(), () => draftAllocationAction({ year: 2026 }));
    if (!d.ok) throw new Error(d.error);
    await expect(runAs(book(), () => approveAllocationAction({ allocationId: d.data.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await runAs(surplusPeople().manager, () => approveAllocationAction({ allocationId: d.data.id }))).ok).toBe(true);
    expect(await runAs(book(), () => postAllocationAction({ allocationId: d.data.id, gaResolutionNo: " " }))).toEqual({ ok: false, error: "Enter the General Assembly resolution no. that approved the allocation" });
    expect((await runAs(book(), () => postAllocationAction({ allocationId: d.data.id, gaResolutionNo: "GA-2027-07" }))).ok).toBe(true);
    expect(await runAs(book(), () => draftAllocationAction({ year: 2026 }))).toEqual({ ok: false, error: "Fiscal year 2026's allocation is already posted" });
  });
});
