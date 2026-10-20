import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { trialBalance } from "@/modules/ledger/service";
import { schedule } from "@/modules/loans/amortization";
import { getLoan, planLoanPayment } from "@/modules/loans/servicing";
import { members } from "@/modules/members/schema";
import { batchErrors, errorWorkbook, getBatch, postMigration, reconciliation, rollbackBatch, stageBatch, stagedRowCount, uploadBatch } from "@/modules/migration/service";
import { templateWorkbook } from "@/modules/migration/templates";
import { memberSoa } from "@/modules/reports/soa";
import { billBalances, assessPenalties } from "@/modules/water/collections";
import { waterAccounts, waterBillingPeriods, waterBills, waterPenalties } from "@/modules/water/schema";
import { P } from "../helpers/phase03";
import { billMonth, setupCollections } from "../helpers/phase07";
import { CUTOFF, filled, importFixture, MEMBERS, memberIdOf, migratedLoanId, migrationUsers, on, setupMigration, upload, uploadAndStage } from "../helpers/phase17";

afterEach(() => setClock(null));

const tbRows = async () => (await trialBalance(CUTOFF)).rows.map((r) => ({ code: r.code, debit: r.debit, credit: r.credit }));

describe("Phase 17 acceptance", () => {
  it("A17.1 the member template has the required headers in the documented order", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await templateWorkbook("members"));
    const headers = (wb.getWorksheet("Members")?.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual([
      "Member No.",
      "Type",
      "Status",
      "Last Name",
      "First Name",
      "Middle Name",
      "Suffix",
      "Birthdate",
      "Sex",
      "Civil Status",
      "House No. / Street",
      "Purok / Sitio",
      "Barangay",
      "Municipality",
      "Province",
      "Mobile",
      "Email",
      "Occupation",
      "TIN",
      "Membership Date",
      "PMES Date",
      "BOD Resolution No.",
      "Membership Fee Paid",
    ]);
    // The "Read me" sheet documents every column in the same order.
    const readMe = wb.getWorksheet("Read me");
    const documented: string[] = [];
    readMe?.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string" && headers.includes(v)) documented.push(v);
    });
    expect(documented).toEqual(headers);
  });

  it("A17.2 dry-run of a file with a missing member no., the bad date 2026-13-01 and a duplicate row → row + column + message for all 3; no live rows", async () => {
    await setupMigration();
    const [m1, m2, m3] = MEMBERS;
    const batch = await upload("members", [
      { ...m1, "Member No.": null },
      { ...m2, "Membership Date": "2026-13-01" },
      m3!,
      m3!,
    ]);
    const errors = [
      { row: 2, column: "Member No.", message: "Required" },
      { row: 3, column: "Membership Date", message: "Not a valid date (use YYYY-MM-DD)" },
      { row: 5, column: "Member No.", message: "Duplicate of row 4" },
    ];
    expect(batch.errorCount).toBe(3);
    expect(await batchErrors(batch.id)).toEqual(errors);
    // The downloadable error list.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await errorWorkbook(batch.id));
    const listed: unknown[] = [];
    wb.getWorksheet("Errors")?.eachRow((row, n) => {
      if (n > 1) listed.push({ row: row.getCell(1).value, column: row.getCell(2).value, message: row.getCell(3).value });
    });
    expect(listed).toEqual(errors);
    // Nothing written to live (or staging) tables.
    expect(await getDb().select().from(members)).toEqual([]);
    expect(await stagedRowCount(batch.id)).toBe(0);
    expect((await getBatch(batch.id))?.status).toBe("UPLOADED");
  });

  it("A17.3 fixture: 3 members, share capital ₱25,000.00, savings ₱12,000.00, 1 REG loan after 2 payments of A10.1 → outstanding ₱8,454.90; subledgers = TB controls; posting allowed; TB after posting = cut-off TB", async () => {
    const { manager } = await setupMigration();
    await importFixture();
    const rec = await reconciliation(CUTOFF);
    expect(rec.rows.filter((r) => r.tb !== 0n || r.subledger !== 0n).map((r) => [r.code, r.tb, r.subledger, r.difference])).toEqual([
      ["11210", P(8454, 90), P(8454, 90), 0n],
      ["21110", P(12000), P(12000), 0n],
      ["31110", P(25000), P(25000), 0n],
    ]);
    expect(rec.canPost).toBe(true);

    await withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager));
    expect(await tbRows()).toEqual([
      { code: "11110", debit: P(28545, 10), credit: 0n },
      { code: "11210", debit: P(8454, 90), credit: 0n },
      { code: "21110", debit: 0n, credit: P(12000) },
      { code: "31110", debit: 0n, credit: P(25000) },
    ]);
    expect((await getLoan(await migratedLoanId("M-000101")))?.outstandingPrincipal).toBe(P(8454, 90));
    // Every member's subledgers equal their lines on the GL control accounts.
    for (const m of MEMBERS) {
      const soa = await memberSoa(await memberIdOf(String(m["Member No."])));
      expect(soa.reconciliation.map((r) => [r.label, r.difference])).toEqual(soa.reconciliation.map((r) => [r.label, 0n]));
    }
    const soa = await memberSoa(await memberIdOf("M-000101"));
    expect([soa.share.paidUp, soa.savings[0]?.balance, soa.loans[0]?.outstandingPrincipal]).toEqual([P(10000), P(5000), P(8454, 90)]);
  });

  it("A17.4 same fixture, TB savings control off by ₱0.01 → posting blocked; reconciliation shows a ₱0.01 difference on Savings Deposits", async () => {
    const { manager } = await setupMigration();
    await importFixture({ savings: 12000.01, cash: 28545.11 });
    const rec = await reconciliation(CUTOFF);
    expect(rec.canPost).toBe(false);
    expect(rec.rows.filter((r) => r.difference !== 0n).map((r) => [r.code, r.name, r.difference])).toEqual([["21110", "Savings Deposits", 1n]]);
    await expect(withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager))).rejects.toThrow(/Savings Deposits.*₱0\.01/);
    expect(await tbRows()).toEqual([]);
  });

  it("A17.5 migrated loan, next payment → installment 3 due amounts equal A10.1 row 3 (interest ₱126.82)", async () => {
    const { manager } = await setupMigration();
    await importFixture();
    await withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager));
    const loanId = await migratedLoanId("M-000101");
    const a101 = schedule({ principal: P(10000), ratePm: "0.015", term: 12, method: "DIMINISHING_EQUAL_AMORT", firstDueDate: "2026-08-07" });
    const row3 = a101[2]!;
    expect(row3.interest).toBe(P(126, 82));
    const loan = await getLoan(loanId);
    expect(loan?.schedule.slice(0, 3).map((r) => [r.no, r.status])).toEqual([
      [1, "PAID"],
      [2, "PAID"],
      [3, "OPEN"],
    ]);
    expect(loan?.schedule[2]).toMatchObject({ dueDate: "2026-10-07", principalDue: row3.principal, interestDue: P(126, 82) });
    const plan = await withTx((tx) => planLoanPayment(tx, loanId, row3.payment));
    expect(plan.allocations).toEqual([{ no: 3, penalty: 0n, interest: P(126, 82), principal: row3.principal }]);
  });

  it("A17.6 upload the same file twice → the second is rejected (duplicate file hash)", async () => {
    const { bookkeeper } = await setupMigration();
    const content = await filled("members", MEMBERS);
    await withTx((tx) => uploadBatch(tx, { entity: "members", fileName: "members.xlsx", content, cutoffDate: CUTOFF }, bookkeeper));
    await expect(withTx((tx) => uploadBatch(tx, { entity: "members", fileName: "members (copy).xlsx", content, cutoffDate: CUTOFF }, bookkeeper))).rejects.toThrow(
      /already uploaded/,
    );
  });

  it("A17.7 roll back an unposted batch → all staged rows removed; batch status ROLLED_BACK", async () => {
    const { bookkeeper } = await setupMigration();
    const batchId = await uploadAndStage("members", MEMBERS);
    expect(await stagedRowCount(batchId)).toBe(3);
    await withTx((tx) => rollbackBatch(tx, batchId, bookkeeper));
    expect(await stagedRowCount(batchId)).toBe(0);
    expect((await getBatch(batchId))?.status).toBe("ROLLED_BACK");
    expect(await getDb().select().from(members)).toEqual([]);
  });

  it("A17.8 water: last reading 1,250, unpaid bill ₱400.00 due 2026-09-15 (penalty assessed), deposit ₱1,000.00; first period reading 1,268 → bill 18 m³ = ₱400.00, total due ₱800.00; AR–Water and Customers' Deposits = TB controls", async () => {
    const base = await setupCollections();
    const { manager } = await migrationUsers();
    on("2026-10-01");
    await uploadAndStage("water_accounts", [
      {
        "Account No.": "WA-000501",
        "Customer No.": "WC-000501",
        "Last Name": "Cruz",
        "First Name": "Ana",
        "Customer Address": "Purok Siete, Pipindan, Binangonan, Rizal",
        Classification: "RESIDENTIAL",
        "Zone Code": "Z1",
        "Route Code": "Z1-R1",
        Sequence: 1,
        "Service Address": "Purok Siete, Pipindan, Binangonan, Rizal",
        Status: "ACTIVE",
        "Connected On": "2019-06-01",
        "Meter Serial No.": "MIG-0501",
        "Last Reading": 1250,
        "Meter Deposit": 1000,
      },
    ]);
    await uploadAndStage("water_bills", [
      { "Account No.": "WA-000501", "Bill No.": "OLD-2026-08-0501", Period: "2026-08", "Bill Date": "2026-08-31", "Due Date": "2026-09-15", Consumption: 18, "Amount Unpaid": 400, "Penalty Assessed": "YES" },
    ]);
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", "Account Name": "Cash on Hand", Debit: 600 },
      { "Account Code": "11260", "Account Name": "Accounts Receivable - Water", Debit: 400 },
      { "Account Code": "21220", "Account Name": "Customers' Deposits - Water", Credit: 1000 },
    ]);
    const rec = await reconciliation(CUTOFF);
    expect(rec.rows.filter((r) => r.tb !== 0n || r.subledger !== 0n).map((r) => [r.code, r.tb, r.subledger, r.difference])).toEqual([
      ["11260", P(400), P(400), 0n],
      ["21220", P(1000), P(1000), 0n],
    ]);
    await withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager));

    const [account] = await getDb().select().from(waterAccounts).where(eq(waterAccounts.accountNo, "WA-000501"));
    if (!account) throw new Error("account not migrated");
    expect(account.depositAmount).toBe(P(1000));
    const balances = await billBalances(getDb(), { accountIds: [account.id] });
    expect(balances.reduce((s, b) => s + b.outstanding, 0n)).toBe(P(400));
    expect(await tbRows()).toEqual([
      { code: "11110", debit: P(600), credit: 0n },
      { code: "11260", debit: P(400), credit: 0n },
      { code: "21220", debit: 0n, credit: P(1000) },
    ]);

    // The penalty was already assessed by the old system: the penalty job doesn't charge it again.
    on("2026-10-02");
    expect(await withTx((tx) => assessPenalties(tx, "2026-10-02"))).toMatchObject({ penalties: 0 });
    expect(await getDb().select().from(waterPenalties)).toEqual([]);

    // First period in the MIS: the last reading (1,250) is the previous reading.
    const { periodId } = await billMonth(base.clerk.id, base.zoneId, "2026-10", [[account.id, 1268]]);
    const [bill] = await getDb()
      .select()
      .from(waterBills)
      .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
      .where(inArray(waterBills.periodId, [periodId]));
    expect(bill?.water_bills).toMatchObject({ consumption: 18, currentAmount: P(400), previousBalance: P(400), totalAmountDue: P(800) });
  });
});
