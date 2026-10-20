import ExcelJS from "exceljs";
import { eq, like } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { hasRun } from "@/lib/jobs";
import { next as nextNumber } from "@/lib/numbering";
import { fiscalYears, journalEntries, periods } from "@/modules/ledger/schema";
import { accruePenalties, getLoan } from "@/modules/loans/servicing";
import { members } from "@/modules/members/schema";
import { dashboardKpis } from "@/modules/reports/kpis";
import { memberSoa } from "@/modules/reports/soa";
import { depositAccounts, depositTransactions, timeDeposits } from "@/modules/savings/schema";
import { isGoodStanding } from "@/modules/share/service";
import { chargeLimit, memberAr } from "@/modules/store/pos";
import { inventoryValuation } from "@/modules/store/reports";
import { suppliers } from "@/modules/store/schema";
import { supplierBalance } from "@/modules/store/service";
import { advanceBalance } from "@/modules/water/billing";
import { assessPenalties, billBalances } from "@/modules/water/collections";
import { readingContext } from "@/modules/water/readings";
import { waterAccounts, waterCustomers, waterDisconnections } from "@/modules/water/schema";
import { auditLog } from "@/modules/audit/schema";
import { postMigrationAction, rollbackBatchAction, uploadBatchAction } from "@/modules/migration/actions";
import { importBatches, stgShareCapital } from "@/modules/migration/schema";
import { batchErrors, getBatch, listBatches, postMigration, reconciliation, rollbackBatch, stageBatch, uploadBatch } from "@/modules/migration/service";
import { accountIdFor, postJournal, trialBalance } from "@/modules/ledger/service";
import { MIGRATION_ENTITIES, TEMPLATES, templateFileName, templateWorkbook } from "@/modules/migration/templates";
import { makeUser } from "../helpers/phase01";
import { P, seedLedger } from "../helpers/phase03";
import { CUTOFF, type Cells, filled, MEMBERS, memberIdOf, migratedLoanId, migrationPeople, migrationUsers, on, setupMigration, upload, uploadAndStage } from "../helpers/phase17";

async function bookkeeperOnly() {
  await seedLedger();
  return { bookkeeper: (await makeUser("BOOKKEEPER", "book17")).id };
}

afterEach(() => setClock(null));

/** The rejection's message (Drizzle wraps the database error; the trigger's text is on the cause). */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
    return `${e instanceof Error ? e.message : String(e)} ${cause}`;
  }
  return "no error";
}

describe("T17.1 migration schema", () => {
  it("an import batch can't be deleted, and a rolled-back one is final; staged rows can't be changed", async () => {
    const { bookkeeper } = await bookkeeperOnly();
    const [b] = await getDb()
      .insert(importBatches)
      .values({ entity: "share_capital", fileName: "s.xlsx", fileHash: "h1", content: Buffer.from("x"), cutoffDate: "2026-09-30", uploadedBy: bookkeeper })
      .returning();
    if (!b) throw new Error("no batch");
    const [row] = await getDb().insert(stgShareCapital).values({ batchId: b.id, rowNo: 2, memberNo: "M-1", subscribed: 100n, paidUp: 100n }).returning();
    expect(await failure(getDb().update(stgShareCapital).set({ paidUp: 0n }).where(eq(stgShareCapital.id, row!.id)))).toMatch(/staged rows can't be changed/);
    expect(await failure(getDb().delete(importBatches).where(eq(importBatches.id, b.id)))).toMatch(/can't be deleted/);
    await withTx(async (tx) => {
      await tx.delete(stgShareCapital).where(eq(stgShareCapital.batchId, b.id));
      await tx.update(importBatches).set({ status: "ROLLED_BACK" }).where(eq(importBatches.id, b.id));
    });
    expect(await failure(getDb().update(importBatches).set({ status: "UPLOADED" }).where(eq(importBatches.id, b.id)))).toMatch(/ROLLED_BACK import batch is final/);
  });

  it("the same file can't be open twice, and only one open batch per kind of record", async () => {
    const { bookkeeper } = await bookkeeperOnly();
    const batch = (hash: string, entity: "members" | "savings") => ({ entity, fileName: `${hash}.xlsx`, fileHash: hash, content: Buffer.from(hash), cutoffDate: "2026-09-30", uploadedBy: bookkeeper });
    await getDb().insert(importBatches).values(batch("a", "members"));
    expect(await failure(getDb().insert(importBatches).values(batch("a", "savings")))).toMatch(/import_batches_hash_uq/);
    expect(await failure(getDb().insert(importBatches).values(batch("b", "members")))).toMatch(/import_batches_open_entity_uq/);
  });
});

describe("T17.2 templates", () => {
  it("every template has its headers in order, a Read me documenting each column, and downloads under its own name", async () => {
    for (const entity of MIGRATION_ENTITIES) {
      const def = TEMPLATES[entity];
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await templateWorkbook(entity));
      expect(wb.worksheets.map((w) => w.name)).toEqual([def.sheet, "Read me"]);
      const headers = (wb.getWorksheet(def.sheet)?.getRow(1).values as unknown[]).slice(1);
      expect(headers).toEqual(def.columns.map((c) => c.header));
      const documented: Array<[unknown, unknown]> = [];
      wb.getWorksheet("Read me")?.eachRow((row) => {
        if (headers.includes(row.getCell(1).value)) documented.push([row.getCell(1).value, row.getCell(2).value]);
      });
      expect(documented).toEqual(def.columns.map((c) => [c.header, c.required ? "Yes" : "No"]));
      expect(templateFileName(entity)).toBe(`migration-${entity.replaceAll("_", "-")}.xlsx`);
    }
  });
});

describe("T17.3 upload, parser, validators and dry-run report", () => {
  it("a clean file is checked without writing live rows; the action takes the file as a form upload and needs migration.import", async () => {
    const { bookkeeper } = await setupMigration();
    const form = new FormData();
    form.set("entity", "members");
    form.set("cutoffDate", CUTOFF);
    form.set("file", new File([new Uint8Array(await filled("members", MEMBERS))], "members.xlsx"));
    const r = await runAs(bookkeeper, () => uploadBatchAction(form));
    expect(r).toMatchObject({ ok: true, data: { status: "VALIDATED", rowCount: 3, errorCount: 0 } });
    expect(await getDb().select().from(members)).toEqual([]);
    const teller = (await makeUser("TELLER", "teller17")).id;
    await expect(runAs(teller, () => uploadBatchAction(form))).rejects.toThrow(/Forbidden: migration.import/);
  });

  it("the cut-off is a month end that is over; a new upload replaces an unstaged file of the same kind", async () => {
    const { bookkeeper } = await setupMigration();
    const up = (cutoffDate: string, rows = MEMBERS) =>
      filled("members", rows).then((content) => withTx((tx) => uploadBatch(tx, { entity: "members", fileName: "m.xlsx", content, cutoffDate }, bookkeeper)));
    await expect(up("2026-09-15")).rejects.toThrow("The cut-off must be the last day of a month (a period end)");
    await expect(up("2026-10-31")).rejects.toThrow(/must be a day that is over/);
    const first = await up(CUTOFF, [{ ...MEMBERS[0]!, Sex: "X" }]);
    expect(await batchErrors(first.id)).toEqual([{ row: 2, column: "Sex", message: "Use one of: MALE, FEMALE" }]);
    const second = await up(CUTOFF);
    expect(second.status).toBe("VALIDATED");
    expect((await getBatch(first.id))?.status).toBe("ROLLED_BACK");
  });

  it("files that aren't the template are refused with one clear problem", async () => {
    const { bookkeeper } = await setupMigration();
    const notExcel = await withTx((tx) => uploadBatch(tx, { entity: "members", fileName: "m.csv", content: new TextEncoder().encode("a,b"), cutoffDate: CUTOFF }, bookkeeper));
    expect(await batchErrors(notExcel.id)).toEqual([{ row: 1, column: "(file)", message: "This isn't an Excel (.xlsx) file; use the downloaded template" }]);
    const wrong = await withTx(async (tx) => uploadBatch(tx, { entity: "savings", fileName: "s.xlsx", content: await filled("members", MEMBERS), cutoffDate: CUTOFF }, bookkeeper));
    expect((await batchErrors(wrong.id))[0]).toMatchObject({ row: 1, column: "(file)", message: `The file has no "Savings" sheet; use the Savings template` });
  });

  it("rows are checked against the staged files and the MIS: members, products, schedules, totals", async () => {
    await setupMigration();
    // Share capital before the members are staged: the members aren't known.
    const early = await upload("share_capital", [{ "Member No.": "M-000101", Subscribed: 10000, "Paid-up": 10000 }]);
    expect(await batchErrors(early.id)).toEqual([{ row: 2, column: "Member No.", message: "No member with this no. (stage the Members file first)" }]);
    await uploadAndStage("members", MEMBERS);
    const share = await upload("share_capital", [
      { "Member No.": "m-000101", Subscribed: 10050, "Paid-up": 100 },
      { "Member No.": "M-000102", Subscribed: 1000, "Paid-up": 2000 },
    ]);
    expect(await batchErrors(share.id)).toEqual([
      { row: 2, column: "Subscribed", message: "Not a whole number of shares (par value ₱100.00)" },
      { row: 3, column: "Paid-up", message: "More than the subscribed amount" },
    ]);
    const savings = await upload("savings", [
      { "Member No.": "M-000101", "Product Code": "XYZ", "Opened On": "2015-03-01", Balance: 5000 },
      { "Member No.": "M-000102", "Product Code": "SAV", "Opened On": "2026-10-05", Balance: "12.345" },
    ]);
    expect(await batchErrors(savings.id)).toEqual([
      { row: 2, column: "Product Code", message: "No savings product XYZ in the MIS" },
      { row: 3, column: "Opened On", message: "After the cut-off (Sep 30, 2026)" },
      { row: 3, column: "Balance", message: "Not an amount (a plain number with up to 2 decimals)" },
    ]);
    const loan = await upload("loans", [
      {
        "Member No.": "M-000101",
        "Product Code": "REG",
        Principal: 10000,
        "Term (months)": 12,
        "Release Date": "2026-07-07",
        "First Due Date": "2026-08-07",
        "Installments Paid": 2,
        "Outstanding Principal": 9000,
      },
    ]);
    expect(await batchErrors(loan.id)).toEqual([
      {
        row: 2,
        column: "Outstanding Principal",
        message: "After 2 installment(s) the schedule's balance is ₱8,454.90: the outstanding principal must be that, or less by part of installment 3's principal (₱789.98)",
      },
    ]);
    const tb = await upload("trial_balance", [
      { "Account Code": "11110", Debit: 100 },
      { "Account Code": "11000", Credit: 50 },
      { "Account Code": "99999", Credit: 50 },
    ]);
    expect(await batchErrors(tb.id)).toEqual([
      { row: 3, column: "Account Code", message: expect.stringMatching(/is a header account/) },
      { row: 4, column: "Account Code", message: "No such account in the chart of accounts" },
    ]);
    const unbalanced = await upload("trial_balance", [
      { "Account Code": "11110", Debit: 100 },
      { "Account Code": "31110", Credit: 99.99 },
    ]);
    expect(await batchErrors(unbalanced.id)).toEqual([{ row: 4, column: "Debit", message: "Total debits ₱100.00 don't equal total credits ₱99.99" }]);
  });

  it("water accounts need a known zone and route, a tariff, and their own meter", async () => {
    await setupMigration();
    const base = { "Customer Address": "Pipindan", Classification: "RESIDENTIAL", "Service Address": "Pipindan", Status: "ACTIVE", "Connected On": "2020-01-01", "Last Reading": 120 };
    const b = await upload("water_accounts", [
      { ...base, "Account No.": "WA-1", "Last Name": "Cruz", "First Name": "Ana", "Zone Code": "NOPE", "Route Code": "R-01", "Meter Serial No.": "S1" },
      { ...base, "Account No.": "WA-2", "Business Name": "Store", "Zone Code": "PIPINDAN", "Route Code": "R-01", "Meter Serial No.": "S1", Classification: "BULK" },
      { ...base, "Account No.": "WA-3", "Zone Code": "PIPINDAN", "Route Code": "R-01", "Meter Serial No.": "S3", "Meter Digits": 4, "Last Reading": 12345 },
    ]);
    expect(await batchErrors(b.id)).toEqual([
      { row: 2, column: "Zone Code", message: "No such zone (Water › Zones & routes)" },
      { row: 3, column: "Classification", message: "No BULK tariff in the MIS yet" },
      { row: 3, column: "Meter Serial No.", message: "Duplicate of row 2" },
      { row: 4, column: "Last Name", message: "Enter the member no., the last and first name, or the business name" },
      { row: 4, column: "Last Reading", message: "Doesn't fit a 4-digit meter" },
    ]);
  });
});

describe("T17.4 staging and reconciliation", () => {
  it("each control account's trial balance amount next to its staged records, and what holds up posting", async () => {
    const { bookkeeper } = await setupMigration();
    await uploadAndStage("members", MEMBERS);
    await uploadAndStage("share_capital", [{ "Member No.": "M-000101", Subscribed: 10000, "Paid-up": 7500 }]);
    const savings = await upload("savings", [{ "Member No.": "M-000101", "Product Code": "SAV", "Opened On": "2015-03-01", Balance: 500 }]);
    let rec = await reconciliation(CUTOFF);
    expect(rec.rows.filter((r) => r.subledger !== 0n || r.tb !== 0n).map((r) => [r.code, r.tb, r.subledger, r.difference])).toEqual([
      ["11270", 0n, P(2500), -P(2500)],
      ["31110", 0n, P(10000), -P(10000)],
    ]);
    expect(rec.blockers).toEqual([
      "Stage the trial balance as of the cut-off",
      "Stage or roll back the Savings file savings.xlsx",
      "11270 Subscription Receivable - Common: the trial balance has ₱0.00 and the subsidiary records ₱2,500.00 (difference -₱2,500.00)",
      "31110 Subscribed Share Capital - Common: the trial balance has ₱0.00 and the subsidiary records ₱10,000.00 (difference -₱10,000.00)",
    ]);
    expect(rec.canPost).toBe(false);

    await withTx((tx) => rollbackBatch(tx, savings.id, bookkeeper));
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 7500 },
      { "Account Code": "11270", Debit: 2500 },
      { "Account Code": "31110", Credit: 10000 },
    ]);
    rec = await reconciliation(CUTOFF);
    expect(rec.blockers).toEqual([]);
    expect(rec.canPost).toBe(true);
    expect([rec.tbDebit, rec.tbCredit]).toEqual([P(10000), P(10000)]);
  });

  it("a ledger entry dated on or before the cut-off holds up posting (the opening entry must be the first)", async () => {
    const { bookkeeper } = await setupMigration();
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 100 },
      { "Account Code": "32100", Credit: 100 },
    ]);
    on("2026-09-15");
    await withTx(async (tx) =>
      postJournal(tx, { date: "2026-09-15", book: "GJ", particulars: "Earlier entry", lines: [{ accountId: await accountIdFor("cash_on_hand", tx), debit: 100n }, { accountId: await accountIdFor("undivided_net_surplus", tx), credit: 100n }] }, bookkeeper),
    );
    on("2026-10-01");
    expect((await reconciliation(CUTOFF)).blockers).toEqual(["The ledger already has 1 entry dated on or before Sep 30, 2026; the opening balances must be the first entry"]);
  });

  it("staging re-checks the file, and a file others refer to is rolled back after them", async () => {
    const { bookkeeper } = await setupMigration();
    const membersId = await uploadAndStage("members", MEMBERS);
    const share = await upload("share_capital", [{ "Member No.": "M-000101", Subscribed: 10000, "Paid-up": 10000 }]);
    await expect(withTx((tx) => rollbackBatch(tx, membersId, bookkeeper))).rejects.toThrow("Roll back the Share capital file(s) first: they refer to the members");
    expect(await withTx((tx) => stageBatch(tx, share.id, bookkeeper))).toEqual({ staged: true, rowCount: 1, errorCount: 0 });
    await expect(withTx((tx) => stageBatch(tx, share.id, bookkeeper))).rejects.toThrow("This file is already staged");
    await withTx((tx) => rollbackBatch(tx, share.id, bookkeeper));
    await withTx((tx) => rollbackBatch(tx, membersId, bookkeeper));
    expect((await getBatch(membersId))?.status).toBe("ROLLED_BACK");
    await expect(withTx((tx) => rollbackBatch(tx, membersId, bookkeeper))).rejects.toThrow("This file is already rolled back");
  });
});

/** Every template filled: the full A-to-Z migration of the T17.5 tests (cut-off Sep 30, 2026). */
async function fullMigration() {
  const people = await setupMigration();
  await uploadAndStage("members", [
    ...MEMBERS,
    { ...MEMBERS[2]!, "Member No.": "M-000104", "Last Name": "Garcia", "First Name": "Rosa", Sex: "FEMALE", Birthdate: "1990-07-07", Status: "INACTIVE", "Membership Fee Paid": null },
  ]);
  await uploadAndStage("share_capital", [
    { "Member No.": "M-000101", Subscribed: 10000, "Paid-up": 7500 },
    { "Member No.": "M-000102", Subscribed: 5000, "Paid-up": 5000 },
  ]);
  await uploadAndStage("savings", [
    { "Member No.": "M-000101", "Account No.": "SA-000150", "Product Code": "SAV", "Opened On": "2015-03-01", Balance: 5000, "Last Transaction Date": "2026-09-12" },
    { "Member No.": "M-000102", "Product Code": "SAV", "Opened On": "2016-07-15", Balance: 2000 },
  ]);
  await uploadAndStage("time_deposits", [{ "Member No.": "M-000101", Principal: 20000, "Rate p.a. (%)": 3.5, "Term (days)": 180, "Placement Date": "2026-06-01" }]);
  await uploadAndStage("loans", [
    // 2 installments paid; installments 3 (Aug 7) and 4 (Sep 7) unpaid at the cut-off.
    { "Member No.": "M-000102", "Product Code": "REG", Principal: 10000, "Term (months)": 12, "Release Date": "2026-05-07", "First Due Date": "2026-06-07", "Installments Paid": 2, "Outstanding Principal": 8454.9, "Unpaid Penalty": 150 },
    // Installment 1 (Sep 7) partly paid: ₱500.00 of its ₱766.80 principal (its interest first).
    { "Member No.": "M-000103", "Loan No.": "LN-2026-00042", "Product Code": "REG", Principal: 10000, "Term (months)": 12, "Release Date": "2026-08-07", "First Due Date": "2026-09-07", "Installments Paid": 0, "Outstanding Principal": 9500 },
  ]);
  const water = { "Customer Address": "Purok Siete, Pipindan", Classification: "RESIDENTIAL", "Zone Code": "PIPINDAN", "Route Code": "R-01", "Service Address": "Purok Siete, Pipindan", "Connected On": "2019-06-01" };
  await uploadAndStage("water_accounts", [
    { ...water, "Account No.": "WA-000501", "Customer No.": "WC-000501", "Last Name": "Cruz", "First Name": "Ana", Status: "ACTIVE", "Meter Serial No.": "MIG-0501", "Last Reading": 1250, "Consumption 1 Month Ago": 15, "Consumption 2 Months Ago": 16, "Consumption 3 Months Ago": 17, "Meter Deposit": 1000 },
    { ...water, "Account No.": "WA-000502", "Member No.": "M-000101", Status: "DISCONNECTED", "Meter Serial No.": "MIG-0502", "Last Reading": 300, "Meter Deposit": 500, "Advance Payment": 100 },
  ]);
  await uploadAndStage("water_bills", [
    { "Account No.": "WA-000501", Period: "2026-08", "Bill Date": "2026-08-31", "Due Date": "2026-09-15", "Amount Unpaid": 400, "Penalty Assessed": "YES" },
    { "Account No.": "WA-000502", Period: "2026-07", "Bill Date": "2026-07-31", "Due Date": "2026-08-15", "Amount Unpaid": 350, "Penalty Assessed": "NO" },
    { "Account No.": "WA-000502", Period: "2026-08", "Bill Date": "2026-08-31", "Due Date": "2026-09-15", "Amount Unpaid": 380, "Penalty Assessed": "NO" },
  ]);
  await uploadAndStage("store_stock", [
    { SKU: "RICE-25", Name: "Rice 25 kg", Unit: "sack", Category: "Grocery", "Selling Price": 1350, "Unit Cost": 1180.5, Quantity: 40, "Reorder Level": 10 },
    { SKU: "SOAP", Name: "Laundry soap", Unit: "bar", Category: "grocery", "Selling Price": 25, "Unit Cost": 20, Quantity: 0 },
  ]);
  await uploadAndStage("suppliers", [
    { "Supplier Name": "S1 Trading", "Terms (days)": 30, Balance: 15250 },
    { "Supplier Name": "S2 Wholesale", Balance: 0 },
  ]);
  await uploadAndStage("store_ar", [{ "Member No.": "M-000102", Balance: 850, "Charge Limit": 2000 }]);
  await uploadAndStage("trial_balance", TB_ROWS);
  return people;
}

const TB_ROWS: Cells[] = [
  { "Account Code": "11110", Debit: 20000 },
  { "Account Code": "11210", Debit: 17954.9 },
  { "Account Code": "11250", Debit: 850 },
  { "Account Code": "11260", Debit: 1130 },
  { "Account Code": "11270", Debit: 2500 },
  { "Account Code": "11310", Debit: 47220 },
  { "Account Code": "21110", Credit: 7000 },
  { "Account Code": "21120", Credit: 20000 },
  { "Account Code": "21210", Credit: 15250 },
  { "Account Code": "21220", Credit: 1500 },
  { "Account Code": "21230", Credit: 100 },
  { "Account Code": "31110", Credit: 15000 },
  { "Account Code": "32100", Credit: 30804.9 },
];

describe("T17.5 posting the opening balances", () => {
  it("one opening entry; every module's records on it; every subsidiary ledger equals its control account", async () => {
    const { manager, bookkeeper } = await fullMigration();
    const rec = await reconciliation(CUTOFF);
    expect(rec.blockers).toEqual([]);
    const posted = await runAs(manager, () => postMigrationAction({ cutoffDate: CUTOFF }));
    if (!posted.ok) throw new Error(posted.error);
    expect(posted.data.jeNo).toMatch(/^GJ-2026-\d{5}$/);

    // The ledger is the cut-off trial balance, and the opening entry is its only entry.
    const tb = (await trialBalance(CUTOFF)).rows.map((r) => [r.code, r.debit > 0n ? r.debit : -r.credit]);
    expect(tb).toEqual(TB_ROWS.map((r) => [r["Account Code"], r.Debit !== undefined ? toCentavos(Number(r.Debit)) : -toCentavos(Number(r.Credit))]));
    const entries = await getDb().select().from(journalEntries);
    expect(entries.map((e) => [e.sourceModule, e.entryDate, e.book])).toEqual([["migration", CUTOFF, "GJ"]]);

    // Every subsidiary agrees with the GL.
    expect((await dashboardKpis()).reconciliation.map((r) => [r.label, r.difference])).toEqual((await dashboardKpis()).reconciliation.map((r) => [r.label, 0n]));
    for (const no of ["M-000101", "M-000102", "M-000103"]) {
      expect((await memberSoa(await memberIdOf(no))).reconciliation.every((r) => r.difference === 0n)).toBe(true);
    }
    const valuation = await inventoryValuation(CUTOFF);
    expect([valuation.total, valuation.difference]).toEqual([P(47220), 0n]);
    const [s1] = await getDb().select().from(suppliers).where(eq(suppliers.name, "S1 Trading"));
    expect(await supplierBalance(s1!.id)).toBe(P(15250));
    const m102 = await memberIdOf("M-000102");
    expect([await memberAr(m102), (await chargeLimit(m102)).limit]).toEqual([P(850), P(2000)]);

    // Members: old numbers kept, the series continues after them; the fee paid before the cut-off counts.
    const [m104] = await getDb().select().from(members).where(eq(members.memberNo, "M-000104"));
    expect([m104?.status, m104?.membershipDate]).toEqual(["INACTIVE", "2018-11-05"]);
    expect(await isGoodStanding(m102)).toBe(true);
    expect(await withTx((tx) => nextNumber("MEMBER", tx))).toBe("M-000105");
    // The other series too: the loan without a number got the one after LN-2026-00042; customers and accounts continue.
    expect((await getLoan(await migratedLoanId("M-000102")))?.loan.loanNo).toBe("LN-2026-00043");
    expect(await withTx(async (tx) => [await nextNumber("LN", tx, "2026-10-01"), await nextNumber("WC", tx), await nextNumber("WA", tx)])).toEqual(["LN-2026-00044", "WC-000503", "WA-000503"]);

    // Savings: the passbook opens with the migrated balance; the interest through Sep 30 is marked as done.
    const savings = await getDb().select().from(depositAccounts).orderBy(depositAccounts.accountNo);
    expect(savings.map((a) => a.accountNo)).toEqual(["SA-000150", "SA-000151", "TD-000001"]);
    const [opening] = await getDb().select().from(depositTransactions).where(eq(depositTransactions.accountId, savings[0]!.id));
    expect([opening?.type, opening?.amount, opening?.txnDate]).toEqual(["OPENING", P(5000), CUTOFF]);
    expect(await withTx((tx) => hasRun(tx, "savings-interest", "SAV:2026-09-30"))).toBe(true);
    const [td] = await getDb().select().from(timeDeposits);
    expect([td?.certificateNo, td?.principal, td?.ratePa, td?.maturityDate, td?.savingsAccountId]).toEqual(["TD-000001-1", P(20000), "0.035", "2026-11-28", savings[0]!.id]);

    // Loans: arrears keep their due dates; the partly paid installment is PARTIAL.
    const l102 = await getLoan(await migratedLoanId("M-000102"));
    expect([l102?.loan.status, l102?.daysPastDue, l102?.unpaidPenalty]).toEqual(["PAST_DUE", 55, P(150)]);
    expect(l102?.schedule.slice(1, 4).map((r) => r.status)).toEqual(["PAID", "OPEN", "OPEN"]);
    const l103 = await getLoan(await migratedLoanId("M-000103"));
    expect([l103?.loan.loanNo, l103?.outstandingPrincipal, l103?.schedule[0]?.status, l103?.schedule[0]?.principalPaid, l103?.schedule[0]?.interestPaid]).toEqual([
      "LN-2026-00042",
      P(9500),
      "PARTIAL",
      P(500),
      P(150),
    ]);
    // Penalties after the cut-off only: Oct 2 adds 2 days on each overdue installment (not every day since its due date).
    on("2026-10-02");
    expect(await withTx((tx) => accruePenalties(tx, "2026-10-02"))).toEqual({ accruals: 3, amount: 122n + 122n + 36n });
    on("2026-10-01");

    // Water: customers, meters at the last reading, consumption history, deposits, advances, the disconnection.
    const accounts = await getDb().select().from(waterAccounts).orderBy(waterAccounts.accountNo);
    expect(accounts.map((a) => [a.accountNo, a.status, a.depositAmount])).toEqual([
      ["WA-000501", "ACTIVE", P(1000)],
      ["WA-000502", "DISCONNECTED", P(500)],
    ]);
    const [c502] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.id, accounts[1]!.customerId));
    expect([c502?.type, c502?.memberId, c502?.lastName]).toEqual(["MEMBER", await memberIdOf("M-000101"), "Dela Cruz"]);
    expect(await advanceBalance(getDb(), c502!.id)).toBe(P(100));
    const ctx = await readingContext(getDb(), accounts[0]!, { period: "2026-10" });
    expect([ctx.previous, ctx.history]).toEqual([1250, [15, 16, 17]]);
    const [notice] = await getDb().select().from(waterDisconnections);
    expect([notice?.status, notice?.noticeAmount, notice?.noticeBills]).toEqual(["DISCONNECTED", P(730), 2]);
    const bills = await billBalances(getDb(), { accountIds: accounts.map((a) => a.id) });
    expect(bills.map((b) => String(b.outstanding)).sort()).toEqual([String(P(350)), String(P(380)), String(P(400))]);
    // The penalty job charges the two bills the old system hadn't (10%), not the one it had.
    on("2026-10-02");
    expect(await withTx((tx) => assessPenalties(tx, "2026-10-02"))).toEqual({ penalties: 2, total: String(P(35) + P(38)) });
    on("2026-10-01");

    // The months up to the cut-off are closed; October is open. The files are posted and final.
    const months = await getDb().select().from(periods).orderBy(periods.month);
    expect(months.filter((p) => p.year === 2026).map((p) => p.status)).toEqual([...Array(9).fill("CLOSED"), "OPEN", "OPEN", "OPEN"]);
    expect((await listBatches()).every((b) => b.status === "POSTED")).toBe(true);
    await expect(withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager))).rejects.toThrow("The opening balances for this cut-off are already posted");
    await expect(upload("members", MEMBERS, "more.xlsx")).rejects.toThrow(/The opening balances were posted \(cut-off Sep 30, 2026\)/);
    const [b] = await listBatches();
    await expect(withTx((tx) => rollbackBatch(tx, b!.id, bookkeeper))).rejects.toThrow("A posted file can't be rolled back");
  });

  it("posting needs migration.post; a blocked reconciliation names every reason", async () => {
    const { bookkeeper, manager } = await setupMigration();
    await uploadAndStage("members", MEMBERS);
    await expect(runAs(bookkeeper, () => postMigrationAction({ cutoffDate: CUTOFF }))).rejects.toThrow(/Forbidden: migration.post/);
    expect(await runAs(manager, () => postMigrationAction({ cutoffDate: CUTOFF }))).toEqual({ ok: false, error: "Posting is blocked: Stage the trial balance as of the cut-off" });
  });

  it("at a fiscal year end the trial balance must be the post-closing one", async () => {
    await seedLedger();
    on("2026-01-15");
    await migrationUsers();
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 1000 },
      { "Account Code": "41110", Credit: 1000 },
    ], "2025-12-31");
    expect((await reconciliation("2025-12-31")).blockers).toEqual([expect.stringMatching(/^Dec 31, 2025 is a fiscal year end: stage the post-closing trial balance/)]);

    // With the post-closing trial balance it posts; fiscal year 2025 is closed and 2026 open.
    const [tb] = await listBatches();
    await withTx((tx) => rollbackBatch(tx, tb!.id, migrationPeople().bookkeeper));
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 1000 },
      { "Account Code": "32100", Credit: 1000 },
    ], "2025-12-31");
    const posted = await withTx((tx) => postMigration(tx, { cutoffDate: "2025-12-31" }, migrationPeople().manager));
    expect(posted.jeNo).toBe("GJ-2025-00001");
    const years = await getDb().select().from(fiscalYears).orderBy(fiscalYears.year);
    expect(years.map((y) => [y.year, y.status])).toEqual([
      [2025, "CLOSED"],
      [2026, "OPEN"],
    ]);
    const months = await getDb().select().from(periods).orderBy(periods.year, periods.month);
    expect(months.filter((m) => m.year === 2025).every((m) => m.status === "CLOSED")).toBe(true);
    expect(months.filter((m) => m.year === 2026).every((m) => m.status === "OPEN")).toBe(true);
  });
});

function toCentavos(pesos: number): bigint {
  return BigInt(Math.round(pesos * 100));
}

describe("T17.6 rollback and audit", () => {
  it("a file's life is in the audit log (upload, stage, rollback, post), by user", async () => {
    const { bookkeeper, manager } = await setupMigration();
    const bad = await upload("members", [{ ...MEMBERS[0]!, Sex: "?" }], "first.xlsx");
    const membersId = await uploadAndStage("members", MEMBERS);
    const tb = await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 100 },
      { "Account Code": "32100", Credit: 100 },
    ]);
    await withTx((tx) => rollbackBatch(tx, tb, bookkeeper));
    await uploadAndStage("trial_balance", [
      { "Account Code": "11110", Debit: 100 },
      { "Account Code": "32100", Credit: 100 },
    ]);
    await withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager));
    const log = await getDb()
      .select({ action: auditLog.action, entityId: auditLog.entityId, userId: auditLog.userId, after: auditLog.after })
      .from(auditLog)
      .where(like(auditLog.action, "migration.%"))
      .orderBy(auditLog.id);
    expect(log.map((l) => [l.action, l.userId])).toEqual([
      ["migration.upload", bookkeeper],
      // The first members file had a problem; the next upload replaced it.
      ["migration.rollback", bookkeeper],
      ["migration.upload", bookkeeper],
      ["migration.stage", bookkeeper],
      ["migration.upload", bookkeeper],
      ["migration.stage", bookkeeper],
      ["migration.rollback", bookkeeper],
      ["migration.upload", bookkeeper],
      ["migration.stage", bookkeeper],
      ["migration.post", manager],
    ]);
    expect(log[1]).toMatchObject({ entityId: bad.id, after: { reason: "replaced by a new upload" } });
    expect(log[3]).toMatchObject({ entityId: membersId, after: { entity: "members", rows: 3 } });
  });

  it("a rolled-back file keeps its file and error list; the same file can then be uploaded again", async () => {
    const { bookkeeper } = await setupMigration();
    const content = await filled("members", [{ ...MEMBERS[0]!, Birthdate: "1980-02-30" }]);
    const up = () => withTx((tx) => uploadBatch(tx, { entity: "members", fileName: "m.xlsx", content, cutoffDate: CUTOFF }, bookkeeper));
    const first = await up();
    await runAs(bookkeeper, () => rollbackBatchAction({ batchId: first.id }));
    expect((await getBatch(first.id))?.content.byteLength).toBe(content.byteLength);
    expect(await batchErrors(first.id)).toEqual([{ row: 2, column: "Birthdate", message: "Not a valid date (use YYYY-MM-DD)" }]);
    expect((await up()).errorCount).toBe(1);
    const teller = (await makeUser("TELLER", "teller176")).id;
    await expect(runAs(teller, () => rollbackBatchAction({ batchId: first.id }))).rejects.toThrow(/Forbidden: migration.import/);
  });
});
