import ExcelJS from "exceljs";
import { CIVIL_STATUSES, SEXES } from "@/modules/members/validation";
import { MEMBER_TYPES } from "@/modules/members/schema";
import { CLASSIFICATIONS } from "@/modules/water/schema";
import { MIGRATION_ENTITIES, type MigrationEntity } from "./schema";

export { MIGRATION_ENTITIES, type MigrationEntity };

/**
 * The Excel templates (PHASE-17 T17.2): one per kind of record, with fixed headers in a fixed
 * order and a "Read me" sheet documenting every column. Dates are typed as text YYYY-MM-DD;
 * amounts are plain numbers in pesos (no ₱ sign).
 */

export type ColumnKind = "text" | "date" | "money" | "int" | "percent" | "cost" | "period" | "choice" | "yesno";

export type TemplateColumn = {
  header: string;
  required: boolean;
  kind: ColumnKind;
  /** The allowed values of a choice column. */
  values?: readonly string[];
  note: string;
  example: string | number;
};

export type TemplateDef = {
  title: string;
  sheet: string;
  purpose: string;
  columns: TemplateColumn[];
};

const col = (header: string, required: boolean, kind: ColumnKind, note: string, example: string | number, values?: readonly string[]): TemplateColumn => ({
  header,
  required,
  kind,
  note,
  example,
  ...(values ? { values } : {}),
});

const MEMBER_NO = col("Member No.", true, "text", "The member's number in the old records. It must be in the Members file (or already in the MIS).", "M-000123");

export const TEMPLATES: Record<MigrationEntity, TemplateDef> = {
  members: {
    title: "Members",
    sheet: "Members",
    purpose: "The member masterlist: one row per approved member. Members keep their old member numbers.",
    columns: [
      col("Member No.", true, "text", "The member's number in the old records; kept as is. Unique.", "M-000123"),
      col("Type", true, "choice", "Regular or associate member.", "REGULAR", MEMBER_TYPES),
      col("Status", true, "choice", "Members who left (terminated, deceased) are not migrated.", "ACTIVE", ["ACTIVE", "INACTIVE"]),
      col("Last Name", true, "text", "", "Dela Cruz"),
      col("First Name", true, "text", "", "Juan"),
      col("Middle Name", false, "text", "", "Santos"),
      col("Suffix", false, "text", "Jr., Sr., III", "Jr."),
      col("Birthdate", true, "date", "YYYY-MM-DD", "1980-05-10"),
      col("Sex", true, "choice", "", "MALE", SEXES),
      col("Civil Status", true, "choice", "", "MARRIED", CIVIL_STATUSES),
      col("House No. / Street", false, "text", "", "123 Rizal St."),
      col("Purok / Sitio", false, "text", "The purok, e.g. Pipindan Munti 1, Mariwasa, Sampaguita.", "Sampaguita"),
      col("Barangay", true, "text", "", "Pipindan"),
      col("Municipality", true, "text", "", "Binangonan"),
      col("Province", true, "text", "", "Rizal"),
      col("Mobile", false, "text", "11 digits, e.g. 09171234567", "09171234567"),
      col("Email", false, "text", "", "juan@example.com"),
      col("Occupation", false, "text", "", "Farmer"),
      col("TIN", false, "text", "", "123-456-789-000"),
      col("Membership Date", true, "date", "When the Board approved the membership (YYYY-MM-DD), on or before the cut-off.", "2015-03-01"),
      col("PMES Date", false, "date", "YYYY-MM-DD", "2015-02-15"),
      col("BOD Resolution No.", false, "text", "", "2015-012"),
      col("Membership Fee Paid", false, "money", "The membership fee paid, in pesos. Blank or 0 = not paid yet.", 500),
    ],
  },
  share_capital: {
    title: "Share capital",
    sheet: "Share capital",
    purpose: "Each member's subscribed and paid-up share capital as of the cut-off. The unpaid part is the subscription receivable.",
    columns: [
      MEMBER_NO,
      col("Subscribed", true, "money", "Total subscribed, in pesos: a whole number of shares at the par value.", 10000),
      col("Paid-up", true, "money", "Total paid-up, in pesos: not more than the subscribed amount.", 7500),
    ],
  },
  savings: {
    title: "Savings",
    sheet: "Savings",
    purpose: "Savings accounts and their balances as of the cut-off (interest up to the cut-off included).",
    columns: [
      MEMBER_NO,
      col("Account No.", false, "text", "The passbook no. in the old records. Blank = the MIS gives a new number.", "SA-000123"),
      col("Product Code", true, "text", "The savings product in the MIS (Savings › Products), e.g. SAV.", "SAV"),
      col("Opened On", true, "date", "YYYY-MM-DD", "2015-03-01"),
      col("Balance", true, "money", "Balance at the cut-off, in pesos.", 5250.75),
      col("Last Transaction Date", false, "date", "The member's last deposit or withdrawal (for dormancy). Blank = the cut-off.", "2026-09-12"),
    ],
  },
  time_deposits: {
    title: "Time deposits",
    sheet: "Time deposits",
    purpose: "Time deposits still running at the cut-off. Interest is paid at maturity for the whole term.",
    columns: [
      MEMBER_NO,
      col("Certificate No.", false, "text", "Blank = the MIS gives a new number.", "TD-0042"),
      col("Principal", true, "money", "In pesos.", 50000),
      col("Rate p.a. (%)", true, "percent", "Interest rate per year, in percent.", 3.5),
      col("Term (days)", true, "int", "", 180),
      col("Placement Date", true, "date", "YYYY-MM-DD", "2026-06-01"),
      col("Maturity Date", false, "date", "Blank = placement date + term. If entered, it must equal placement date + term.", "2026-11-28"),
      col("Savings Account No.", false, "text", "The member's savings account that receives the proceeds. Blank = their savings account.", "SA-000123"),
    ],
  },
  loans: {
    title: "Loans",
    sheet: "Loans",
    purpose:
      "Loans still unpaid at the cut-off. The schedule is rebuilt from the original terms; the first installments are marked paid; installments due and unpaid at the cut-off stay as arrears with their due dates.",
    columns: [
      MEMBER_NO,
      col("Loan No.", false, "text", "Blank = the MIS gives a new number.", "LN-2026-00042"),
      col("Product Code", true, "text", "The loan product in the MIS (REG, EMR, PRD).", "REG"),
      col("Principal", true, "money", "The amount originally released, in pesos.", 10000),
      col("Term (months)", true, "int", "", 12),
      col("Rate per Month (%)", false, "percent", "Blank = the product's rate.", 1.5),
      col("Release Date", true, "date", "YYYY-MM-DD", "2026-07-07"),
      col("First Due Date", true, "date", "Due date of installment 1 (YYYY-MM-DD).", "2026-08-07"),
      col("Installments Paid", true, "int", "How many installments are fully paid.", 2),
      col(
        "Outstanding Principal",
        true,
        "money",
        "Principal still unpaid at the cut-off. It must equal the schedule's balance after the installments paid, less any part of the next installment's principal already paid.",
        8454.9,
      ),
      col("Unpaid Penalty", false, "money", "Penalties charged and unpaid at the cut-off. Penalties after the cut-off are charged by the MIS.", 0),
    ],
  },
  water_accounts: {
    title: "Water accounts",
    sheet: "Water accounts",
    purpose:
      "Water customers, their service connections and meters. The last actual reading becomes the previous reading of the first billing period in the MIS.",
    columns: [
      col("Account No.", true, "text", "The service account no. in the old records. Unique.", "WA-000123"),
      col("Customer No.", false, "text", "Rows with the same customer no. are one customer with several connections. Blank = the MIS gives a new number.", "WC-000045"),
      col("Member No.", false, "text", "For a member customer: the member no. (name fields can stay blank).", "M-000123"),
      col("Last Name", false, "text", "For a non-member: last and first name, or the business name.", "Cruz"),
      col("First Name", false, "text", "", "Ana"),
      col("Middle Name", false, "text", "", "Reyes"),
      col("Business Name", false, "text", "", "Ana's Eatery"),
      col("Customer Address", true, "text", "", "Purok Siete, Pipindan, Binangonan, Rizal"),
      col("Mobile", false, "text", "", "09171234567"),
      col("Classification", true, "choice", "", "RESIDENTIAL", CLASSIFICATIONS),
      col("Zone Code", true, "text", "The zone (purok) in the MIS (Water › Zones & routes).", "SAMPAGUITA"),
      col("Route Code", true, "text", "The reading route in that zone.", "SAMPAGUITA-R1"),
      col("Sequence", false, "int", "The meter's place in the reading route. Blank = after the others.", 12),
      col("Service Address", true, "text", "", "Lot 5, Sampaguita St., Pipindan"),
      col("Status", true, "choice", "", "ACTIVE", ["ACTIVE", "DISCONNECTED"]),
      col("Connected On", true, "date", "YYYY-MM-DD", "2019-06-01"),
      col("Meter Serial No.", true, "text", "Unique.", "MTR-12345"),
      col("Meter Digits", false, "int", "Digits on the meter dial (3–9). Blank = 4, or more if the last reading needs it.", 4),
      col("Last Reading", true, "int", "The last actual reading in the old system (m³).", 1250),
      col("Consumption 1 Month Ago", false, "int", "m³ billed for the month of the cut-off (for the high-consumption check).", 18),
      col("Consumption 2 Months Ago", false, "int", "m³ billed the month before.", 17),
      col("Consumption 3 Months Ago", false, "int", "m³ billed the month before that.", 20),
      col("Meter Deposit", false, "money", "The refundable meter deposit held, in pesos.", 1000),
      col("Advance Payment", false, "money", "Payments received ahead of billing, in pesos (applied to the next bills).", 0),
    ],
  },
  water_bills: {
    title: "Unpaid water bills",
    sheet: "Unpaid water bills",
    purpose: "Every water bill still unpaid (or partly paid) at the cut-off, so aging, penalties and disconnection work on day one.",
    columns: [
      col("Account No.", true, "text", "The service account (in the Water accounts file or already in the MIS).", "WA-000123"),
      col("Bill No.", false, "text", "Blank = the MIS gives a new number.", "2026-08-0123"),
      col("Period", true, "period", "The billing month (YYYY-MM), on or before the cut-off month.", "2026-08"),
      col("Bill Date", true, "date", "YYYY-MM-DD", "2026-08-31"),
      col("Due Date", true, "date", "YYYY-MM-DD", "2026-09-15"),
      col("Consumption", false, "int", "m³ billed (for the statement).", 18),
      col("Amount Unpaid", true, "money", "What is still unpaid on the bill, including any penalty already charged, in pesos.", 400),
      col("Penalty Assessed", true, "yesno", "YES if the old system already charged the late-payment penalty on this bill (the MIS won't charge it again).", "YES", ["YES", "NO"]),
    ],
  },
  store_stock: {
    title: "Store stock",
    sheet: "Store stock",
    purpose: "The store's stock count at the cut-off, at cost. Items not yet in the MIS are created.",
    columns: [
      col("SKU", true, "text", "The item code. Unique.", "RICE-25"),
      col("Barcode", false, "text", "", "4800000000017"),
      col("Name", true, "text", "", "Rice 25 kg"),
      col("Unit", true, "text", "", "sack"),
      col("Category", false, "text", "", "Grocery"),
      col("Selling Price", true, "money", "In pesos.", 1350),
      col("Unit Cost", true, "cost", "Average cost per unit, in pesos (up to 4 decimals).", 1180.5),
      col("Quantity", true, "int", "Counted on hand.", 40),
      col("Reorder Level", false, "int", "", 10),
    ],
  },
  suppliers: {
    title: "Supplier balances",
    sheet: "Supplier balances",
    purpose: "Store suppliers and what the coop owes each one (accounts payable – trade) at the cut-off.",
    columns: [
      col("Supplier Name", true, "text", "Unique.", "S1 Trading"),
      col("Contact", false, "text", "", "0917 000 1111"),
      col("TIN", false, "text", "", "000-111-222-000"),
      col("Terms (days)", false, "int", "Credit terms. Blank = 0 (cash).", 30),
      col("Balance", true, "money", "Amount owed at the cut-off, in pesos (0 for a supplier with nothing owed).", 15250),
    ],
  },
  store_ar: {
    title: "Store charges",
    sheet: "Store charges",
    purpose: "What members owe the store for goods charged to their account, at the cut-off.",
    columns: [
      MEMBER_NO,
      col("Balance", true, "money", "Unpaid charges, in pesos.", 850),
      col("Charge Limit", false, "money", "The member's charge limit. Blank = the default limit.", 1000),
    ],
  },
  trial_balance: {
    title: "Trial balance",
    sheet: "Trial balance",
    purpose:
      "The audited (or Board-approved) trial balance as of the cut-off. It becomes the opening entry; every control account must equal its subsidiary records to the centavo.",
    columns: [
      col("Account Code", true, "text", "The account code in the MIS chart of accounts (Accounting › Chart of accounts). One row per account.", "11110"),
      col("Account Name", false, "text", "For reading only.", "Cash on Hand"),
      col("Debit", false, "money", "In pesos. Enter either a debit or a credit.", 125000),
      col("Credit", false, "money", "In pesos.", 0),
    ],
  },
};

/** The file name a template downloads as. */
export const templateFileName = (entity: MigrationEntity) => `migration-${entity.replaceAll("_", "-")}.xlsx`;

const NUM_FMT: Partial<Record<ColumnKind, string>> = { money: "#,##0.00", cost: "#,##0.0000", int: "0", percent: "0.00", date: "@", period: "@", text: "@" };

/** The bytes of a workbook, as a plain ArrayBuffer (what ExcelJS reads back and a Response sends). */
export async function workbookBytes(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer;
}

// ExcelJS has worksheet.dataValidations at runtime but leaves it out of its typings.
type WithValidations = { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } };

/** The template workbook: the data sheet (headers only) and the "Read me" sheet. */
export async function templateWorkbook(entity: MigrationEntity): Promise<ArrayBuffer> {
  const def = TEMPLATES[entity];
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCMPC MIS";
  const ws = wb.addWorksheet(def.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = def.columns.map((c) => ({ header: c.header, width: Math.max(14, c.header.length + 4), style: NUM_FMT[c.kind] ? { numFmt: NUM_FMT[c.kind] } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  def.columns.forEach((c, i) => {
    head.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FFFDE68A" : "FFE5E7EB" } };
    if (c.values) {
      // A pick-list on the column, so only allowed values are typed.
      (ws as unknown as WithValidations).dataValidations.add(`${ws.getColumn(i + 1).letter}2:${ws.getColumn(i + 1).letter}5000`, {
        type: "list",
        allowBlank: !c.required,
        formulae: [`"${c.values.join(",")}"`],
      });
    }
  });

  const rm = wb.addWorksheet("Read me");
  rm.columns = [{ width: 28 }, { width: 11 }, { width: 90 }, { width: 24 }];
  rm.addRow([`PCMPC data migration · ${def.title}`]).font = { bold: true, size: 14 };
  rm.addRow([def.purpose]);
  rm.addRow([]);
  for (const line of [
    `Fill in the "${def.sheet}" sheet: one row per record, from row 2. Don't rename, reorder or add columns.`,
    "Dates: YYYY-MM-DD (e.g. 2026-09-30). Amounts: plain numbers in pesos, up to 2 decimals (no ₱ sign).",
    "Yellow headers are required; grey ones are optional. The upload checks every row and lists each problem with its row and column.",
  ]) {
    rm.addRow([line]);
  }
  rm.addRow([]);
  const th = rm.addRow(["Column", "Required", "What to enter", "Example"]);
  th.font = { bold: true };
  for (const c of def.columns) {
    const allowed = c.values ? ` One of: ${c.values.join(", ")}.` : "";
    rm.addRow([c.header, c.required ? "Yes" : "No", `${c.note}${allowed}`.trim(), c.example]);
  }
  return workbookBytes(wb);
}
