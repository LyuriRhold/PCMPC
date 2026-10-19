import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { trialBalance } from "@/modules/ledger/service";
import { runReportAction } from "@/modules/reports/actions";
import { caprWorkbook } from "@/modules/reports/cda";
import { dashboardKpis, efficiencyPercent } from "@/modules/reports/kpis";
import { membershipSummary } from "@/modules/reports/membership";
import { memberSoa } from "@/modules/reports/soa";
import { updateSetting } from "@/modules/settings/service";
import { makeUser } from "../helpers/phase01";
import { P, seedLedger } from "../helpers/phase03";
import { activeAccount } from "../helpers/phase06";
import { at, billMonth, payWater, setupCollections } from "../helpers/phase07";
import { postFixture, setupFs } from "../helpers/phase14";
import { glSubsidiary, membersFixture, on, performanceFixture, soaFixture } from "../helpers/phase16";

afterEach(() => setClock(null));

describe("Phase 16 acceptance", () => {
  it("A16.1 dues in the month ₱100,000.00, collected on those dues ₱92,500.00 → collection efficiency 92.50%", () => {
    expect(efficiencyPercent(P(100000), P(92500))).toBe("92.50%");
  });

  it("A16.2 members fixture: 3 regular male, 2 regular female, 1 associate female → summary: regular 5 (M3/F2), associate 1 (F1), total 6", async () => {
    await membersFixture();
    expect(await membershipSummary()).toMatchObject({
      regular: { male: 3, female: 2, total: 5 },
      associate: { male: 0, female: 1, total: 1 },
      total: 6,
    });
  });

  it("A16.3 SOA for M-000001 → each balance equals the respective GL subsidiary balance", async () => {
    const f = await soaFixture();
    const soa = await memberSoa(f.memberId);
    expect(soa.member.memberNo).toBe("M-000001");
    // Share capital: 100 shares subscribed (₱10,000.00); ₱2,500.00 paid + ₱200.00 CBU retained on the loan.
    expect(soa.share).toEqual({ subscribed: P(10000), paidUp: P(2700), unpaid: P(7300) });
    expect(soa.share.subscribed).toBe(-(await glSubsidiary("subscribed_share_capital_common", f.memberId)));
    expect(soa.share.unpaid).toBe(await glSubsidiary("subscription_receivable_common", f.memberId));
    // Savings ₱1,500.00; the loan ₱10,000.00; the store account ₱350.00.
    expect(soa.savings.reduce((s, a) => s + a.balance, 0n)).toBe(P(1500));
    expect(soa.savings.reduce((s, a) => s + a.balance, 0n)).toBe(-(await glSubsidiary("savings_deposits", f.memberId)));
    expect(soa.loans.reduce((s, l) => s + l.outstandingPrincipal, 0n)).toBe(P(10000));
    expect(soa.loans.reduce((s, l) => s + l.outstandingPrincipal, 0n)).toBe(await glSubsidiary("loans_receivable_REG", f.memberId));
    expect(soa.storeAr).toBe(P(350));
    expect(soa.storeAr).toBe(await glSubsidiary("accounts_receivable_members", f.memberId));
    expect(soa.reconciliation.every((r) => r.difference === 0n)).toBe(true);
  });

  it("A16.4 dashboard KPIs on the Phase 14 fixture → loan portfolio ₱80,000.00; deposits ₱51,000.00; paid-up ₱100,000.00", async () => {
    await setupFs();
    await postFixture();
    const k = await dashboardKpis();
    expect([k.loanPortfolio, k.deposits, k.paidUp]).toEqual([P(80000), P(51000), P(100000)]);
  });

  it("A16.5 generate the CAPR workbook → valid .xlsx; contains the CDA reg. no. and reporting year; \"Unmapped fields\" sheet present (may be empty)", async () => {
    await seedLedger();
    const admin = (await makeUser("ADMIN", "admin1")).id;
    await withTx((tx) => updateSetting(tx, "coop.cda_reg_no", "9520-04012345", admin));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await caprWorkbook(2026)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain("Unmapped fields");
    const text: string[] = [];
    wb.worksheets.forEach((ws) => ws.eachRow((row) => row.eachCell((c) => text.push(String(c.value ?? "")))));
    expect(text.some((t) => t.includes("9520-04012345"))).toBe(true);
    expect(text.some((t) => t.includes("2026"))).toBe(true);
  });

  it("A16.6 BOARD user opens the delinquency report → allowed; mobile numbers masked", async () => {
    await soaFixture();
    on("2026-12-15"); // the first installment (Nov 5) is 40 days past due
    const board = (await makeUser("BOARD", "board1")).id;
    const r = await runAs(board, () => runReportAction({ key: "delinquency", params: { asOf: "2026-12-15" } }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.rows.length).toBeGreaterThan(0);
    const row = r.data.rows[0]!;
    expect(row.memberNo).toBe("M-000001");
    expect(row.mobile).toBe("•••••••4567");
    expect(JSON.stringify(r.data.rows)).not.toContain("09171234567");
  });

  it("A16.7 TB as-of on the performance fixture → < 5 s", async () => {
    await performanceFixture();
    const started = performance.now();
    const tb = await trialBalance("2026-12-31");
    expect(performance.now() - started).toBeLessThan(5000);
    expect(tb.balanced).toBe(true);
  }, 120_000);

  it("A16.8 dashboard water tiles on the Phase 06/07 fixtures → billed ₱1,705.00; collection efficiency 76.54% (equal to the Phase 07 reports)", async () => {
    const u = await setupCollections();
    setClock(() => at("2026-10-01"));
    const acc = (o: Partial<Parameters<typeof activeAccount>[0]>) => activeAccount({ clerk: u.clerk.id, manager: u.manager.id, routeId: u.routeId, initialReading: 0, ...o });
    const member = await acc({ kind: "MEMBER" });
    const non = await acc({ kind: "NON_MEMBER" });
    const senior = await acc({ kind: "MEMBER", senior: true });
    await billMonth(u.clerk.id, u.zoneId, "2026-10", [
      [member.accountId, 18],
      [non.accountId, 35],
      [senior.accountId, 18],
    ]);
    setClock(() => at("2026-11-10"));
    expect((await payWater(non.customer.id, non.accountId, "925.00")).ok).toBe(true);
    expect((await payWater(senior.customer.id, senior.accountId, "380.00")).ok).toBe(true);
    const k = await dashboardKpis();
    expect(k.water).toMatchObject({ billed: P(1705), collected: P(1305), efficiency: "76.54%" });
  });
});
