import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { getDb, withTx } from "@/db/client";
import { setClock, type BusinessDate } from "@/lib/dates";
import { loans } from "@/modules/loans/schema";
import { members } from "@/modules/members/schema";
import { batchErrors, stageBatch, uploadBatch } from "@/modules/migration/service";
import { TEMPLATES, templateWorkbook, type MigrationEntity } from "@/modules/migration/templates";
import { makeUser } from "./phase01";
import { seedLedger } from "./phase03";

/** The cut-off of the test migrations: books migrated as of Sep 30, 2026; go-live Oct 1. */
export const CUTOFF: BusinessDate = "2026-09-30";

/** Manila 09:00 on a business date. */
export function on(date: BusinessDate): void {
  setClock(() => new Date(`${date}T01:00:00Z`));
}

let people = { bookkeeper: "", manager: "" };

/** The bookkeeper who imports (migration.import) and the manager who posts (migration.post). */
export async function migrationUsers() {
  people = { bookkeeper: (await makeUser("BOOKKEEPER", "book17")).id, manager: (await makeUser("MANAGER", "mgr17")).id };
  return people;
}

export const migrationPeople = () => people;

/** Reference data, FY 2026, the migration users, and the clock on go-live day (Oct 1, 2026). */
export async function setupMigration() {
  await seedLedger();
  on("2026-10-01");
  return migrationUsers();
}

export type Cells = Record<string, string | number | null>;

/** The generator's template for `entity` with `rows` under its headers (cells by header name). */
export async function filled(entity: MigrationEntity, rows: Cells[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await templateWorkbook(entity));
  const ws = wb.getWorksheet(TEMPLATES[entity].sheet);
  if (!ws) throw new Error(`template ${entity} has no sheet ${TEMPLATES[entity].sheet}`);
  const headers = TEMPLATES[entity].columns.map((c) => c.header);
  rows.forEach((r, i) => {
    for (const [header, value] of Object.entries(r)) {
      const col = headers.indexOf(header);
      if (col < 0) throw new Error(`${entity} has no column "${header}"`);
      if (value !== null && value !== "") ws.getCell(i + 2, col + 1).value = value;
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Uploads (and dry-runs) a filled template as the bookkeeper. */
export async function upload(entity: MigrationEntity, rows: Cells[], fileName = `${entity}.xlsx`) {
  const content = await filled(entity, rows);
  return withTx((tx) => uploadBatch(tx, { entity, fileName, content, cutoffDate: CUTOFF }, people.bookkeeper));
}

/** Uploads and stages a file that must be clean. */
export async function uploadAndStage(entity: MigrationEntity, rows: Cells[]): Promise<string> {
  const b = await upload(entity, rows);
  if (b.errorCount > 0) throw new Error(`${entity}: ${JSON.stringify(await batchErrors(b.id))}`);
  await withTx((tx) => stageBatch(tx, b.id, people.bookkeeper));
  return b.id;
}

const member = (no: string, last: string, first: string, sex: "MALE" | "FEMALE", birthdate: string, since: string): Cells => ({
  "Member No.": no,
  Type: "REGULAR",
  Status: "ACTIVE",
  "Last Name": last,
  "First Name": first,
  Birthdate: birthdate,
  Sex: sex,
  "Civil Status": "MARRIED",
  "Purok / Sitio": "Sampaguita",
  Barangay: "Pipindan",
  Municipality: "Binangonan",
  Province: "Rizal",
  "Membership Date": since,
  "Membership Fee Paid": 500,
});

/** The 3 members of the A17.3 fixture. */
export const MEMBERS: Cells[] = [
  member("M-000101", "Dela Cruz", "Juan", "MALE", "1980-05-10", "2015-03-01"),
  member("M-000102", "Santos", "Maria", "FEMALE", "1985-08-21", "2016-07-15"),
  member("M-000103", "Reyes", "Pedro", "MALE", "1975-01-30", "2018-11-05"),
];

/**
 * The A17.3 fixture, staged: 3 members; share capital ₱25,000.00 (fully paid); savings
 * ₱12,000.00; one REG loan (A10.1: ₱10,000, 12 months, 1.5%/month) after 2 payments, so
 * ₱8,454.90 outstanding; and the cut-off trial balance (cash is the balancing line).
 */
export async function importFixture(tb: { savings?: number; cash?: number } = {}) {
  await uploadAndStage("members", MEMBERS);
  await uploadAndStage("share_capital", [
    { "Member No.": "M-000101", Subscribed: 10000, "Paid-up": 10000 },
    { "Member No.": "M-000102", Subscribed: 10000, "Paid-up": 10000 },
    { "Member No.": "M-000103", Subscribed: 5000, "Paid-up": 5000 },
  ]);
  await uploadAndStage("savings", [
    { "Member No.": "M-000101", "Product Code": "SAV", "Opened On": "2015-03-01", Balance: 5000 },
    { "Member No.": "M-000102", "Product Code": "SAV", "Opened On": "2016-07-15", Balance: 4000 },
    { "Member No.": "M-000103", "Product Code": "SAV", "Opened On": "2018-11-05", Balance: 3000 },
  ]);
  await uploadAndStage("loans", [
    {
      "Member No.": "M-000101",
      "Product Code": "REG",
      Principal: 10000,
      "Term (months)": 12,
      "Release Date": "2026-07-07",
      "First Due Date": "2026-08-07",
      "Installments Paid": 2,
      "Outstanding Principal": 8454.9,
    },
  ]);
  await uploadAndStage("trial_balance", [
    { "Account Code": "11110", "Account Name": "Cash on Hand", Debit: tb.cash ?? 28545.1 },
    { "Account Code": "11210", "Account Name": "Loans Receivable - Regular", Debit: 8454.9 },
    { "Account Code": "21110", "Account Name": "Savings Deposits", Credit: tb.savings ?? 12000 },
    { "Account Code": "31110", "Account Name": "Subscribed Share Capital - Common", Credit: 25000 },
  ]);
}

export async function memberIdOf(memberNo: string): Promise<string> {
  const [m] = await getDb().select({ id: members.id }).from(members).where(eq(members.memberNo, memberNo));
  if (!m) throw new Error(`no member ${memberNo}`);
  return m.id;
}

/** The migrated loan of a member. */
export async function migratedLoanId(memberNo: string): Promise<string> {
  const [l] = await getDb().select({ id: loans.id }).from(loans).where(eq(loans.memberId, await memberIdOf(memberNo)));
  if (!l) throw new Error(`no loan for ${memberNo}`);
  return l.id;
}
