import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { members } from "@/modules/members/schema";
import { uploadBatchAction } from "@/modules/migration/actions";
import { importBatches, stgShareCapital } from "@/modules/migration/schema";
import { batchErrors, getBatch, reconciliation, rollbackBatch, stageBatch, uploadBatch } from "@/modules/migration/service";
import { accountIdFor, postJournal } from "@/modules/ledger/service";
import { MIGRATION_ENTITIES, TEMPLATES, templateFileName, templateWorkbook } from "@/modules/migration/templates";
import { makeUser } from "../helpers/phase01";
import { P, seedLedger } from "../helpers/phase03";
import { CUTOFF, filled, MEMBERS, on, setupMigration, upload, uploadAndStage } from "../helpers/phase17";

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
