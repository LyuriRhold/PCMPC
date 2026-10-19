import { existsSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { addDays, addMonths, formatDate, formatDateTime, monthEnd, now, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { financialCondition, operations } from "@/modules/accounting/statements";
import { listOfficers, officerTrainingHours } from "@/modules/governance/service";
import { accountMappings, fiscalYears, journalEntries, journalLines } from "@/modules/ledger/schema";
import { members, memberStatusHistory } from "@/modules/members/schema";
import { getSetting } from "@/modules/settings/service";
import { CDA_TEMPLATES, type CdaTemplate } from "./cda-templates";
import { membershipMovement } from "./membership";

/**
 * The CDA annual report data (PHASE-16 T16.2): every figure the MIS can give the CAPR and its
 * attachments, by key, and the workbook: the CDA template filled where a template is mapped
 * (`cda-templates.ts`), otherwise the MIS's own data sheets, always with a cover and an "Unmapped
 * fields" sheet. The CDA deadline is 120 days after the fiscal year ends (PLAN R2).
 */

/** A CAPR figure: text, a count, or an amount (centavos). */
export type CaprField = { key: string; section: string; label: string; value: string | number | Money; money?: boolean };

const POSTED = ["POSTED", "REVERSED"] as const;

/** Pesos as a spreadsheet number (2 decimals), as in the other exports. */
function pesos(m: Money): number {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const value = Number(abs / 100n) + Number(abs % 100n) / 100;
  return neg ? -value : value;
}

async function fiscalYear(year: number, db: Db | Tx) {
  const [fy] = await db.select().from(fiscalYears).where(eq(fiscalYears.year, year));
  if (fy) return { start: fy.startDate, end: fy.endDate };
  const start = `${year}-${String(await getSetting("fiscal.year_start_month", db)).padStart(2, "0")}-01`;
  return { start, end: monthEnd(addMonths(start, 11)) };
}

/**
 * What was taken out of an account in the year: the debits of entries posted in the window that
 * stand (not reversed, and not themselves reversals). E.g. CETF remitted, CDF used (Q-16.6).
 */
async function usedInYear(key: string, from: BusinessDate, to: BusinessDate, db: Db | Tx): Promise<Money> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, eq(accountMappings.accountId, journalLines.accountId))
    .where(and(eq(accountMappings.key, key), eq(journalEntries.status, "POSTED"), isNull(journalEntries.reversalOfId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)));
  return BigInt(r?.s ?? "0");
}

/** Balance (debit − credit) of the accounts mapped to a key as of a date; with `from`, only the movement since. */
async function glBalance(key: string, to: BusinessDate, db: Db | Tx, from?: BusinessDate, side: "net" | "debit" = "net"): Promise<Money> {
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${side === "debit" ? journalLines.debit : sql`${journalLines.debit} - ${journalLines.credit}`}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, eq(accountMappings.accountId, journalLines.accountId))
    .where(and(eq(accountMappings.key, key), inArray(journalEntries.status, [...POSTED]), lte(journalEntries.entryDate, to), from ? gte(journalEntries.entryDate, from) : undefined));
  return BigInt(r?.s ?? "0");
}

/** Members by type and sex as of a date: joined by then, not terminated or deceased by then. */
async function membersAsOf(asOf: BusinessDate, db: Db | Tx) {
  const left = db
    .select({ id: memberStatusHistory.memberId })
    .from(memberStatusHistory)
    .where(and(inArray(memberStatusHistory.toStatus, ["TERMINATED", "DECEASED"]), sql`(${memberStatusHistory.at} AT TIME ZONE 'Asia/Manila')::date <= ${asOf}`));
  const rows = await db
    .select({ type: members.type, sex: members.sex, n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(lte(members.membershipDate, asOf), sql`${members.id} NOT IN (${left})`))
    .groupBy(members.type, members.sex);
  const count = (type: string, sex?: string) => rows.filter((r) => r.type === type && (!sex || r.sex === sex)).reduce((s, r) => s + r.n, 0);
  return {
    regularMale: count("REGULAR", "MALE"),
    regularFemale: count("REGULAR", "FEMALE"),
    associateMale: count("ASSOCIATE", "MALE"),
    associateFemale: count("ASSOCIATE", "FEMALE"),
    regular: count("REGULAR"),
    associate: count("ASSOCIATE"),
  };
}

/** Every figure the MIS gives the CAPR for a fiscal year, by key. */
export async function caprData(year: number, db: Db | Tx = getDb()): Promise<CaprField[]> {
  const { start, end } = await fiscalYear(year, db);
  const out: CaprField[] = [];
  const add = (section: string, key: string, label: string, value: string | number | Money, money = typeof value === "bigint") => out.push({ section, key, label, value, money });

  add("Cooperative", "coop.name", "Name of the cooperative", await getSetting("coop.name", db));
  add("Cooperative", "coop.cda_reg_no", "CDA registration no.", (await getSetting("coop.cda_reg_no", db)) || "(not set)");
  add("Cooperative", "coop.tin", "TIN", (await getSetting("coop.tin", db)) || "(not set)");
  add("Cooperative", "coop.address", "Address", await getSetting("coop.address", db));
  add("Cooperative", "report.year", "Reporting year", year);
  add("Cooperative", "report.period", "Period covered", `${formatDate(start)} to ${formatDate(end)}`);

  const m = await membersAsOf(end, db);
  const moved = await membershipMovement(start, end, db);
  add("Membership", "members.regular.male", "Regular members, male", m.regularMale);
  add("Membership", "members.regular.female", "Regular members, female", m.regularFemale);
  add("Membership", "members.regular.total", "Regular members, total", m.regular);
  add("Membership", "members.associate.male", "Associate members, male", m.associateMale);
  add("Membership", "members.associate.female", "Associate members, female", m.associateFemale);
  add("Membership", "members.associate.total", "Associate members, total", m.associate);
  add("Membership", "members.total", "Members, total", m.regular + m.associate);
  add("Membership", "members.new", "New members in the year", moved.joined.total);
  add("Membership", "members.terminated", "Members terminated in the year", moved.terminated);
  add("Membership", "members.deceased", "Members deceased in the year", moved.deceased);

  const subscribed = -(await glBalance("subscribed_share_capital_common", end, db));
  const receivable = await glBalance("subscription_receivable_common", end, db);
  add("Capitalization", "capital.subscribed", "Subscribed share capital", subscribed);
  add("Capitalization", "capital.receivable", "Subscription receivable", receivable);
  add("Capitalization", "capital.paid_up", "Paid-up share capital", subscribed - receivable);

  const sfc = await financialCondition(end, {}, db);
  const soo = await operations(start, end, {}, db);
  add("Financial highlights", "fs.total_assets", "Total assets", sfc.totals.assets);
  add("Financial highlights", "fs.total_liabilities", "Total liabilities", sfc.totals.liabilities);
  add("Financial highlights", "fs.total_equity", "Total equity", sfc.totals.equity);
  add("Financial highlights", "fs.revenues", "Total revenues", soo.totals.revenues);
  add("Financial highlights", "fs.expenses", "Total expenses", soo.totals.expenses);
  add("Financial highlights", "fs.net_surplus", "Net surplus", soo.totals.netSurplus);
  for (const seg of soo.segments) {
    const t = soo.segmentTotals[seg.code];
    if (t) add("Revenue by business line", `revenue.${seg.code.toLowerCase()}`, `Revenue: ${seg.name}`, t.revenues);
  }

  add("Statutory funds", "funds.reserve", "Reserve fund", -(await glBalance("reserve_fund", end, db)), true);
  add("Statutory funds", "funds.etf_local", "Education and training fund (local)", -(await glBalance("education_training_fund", end, db)), true);
  add("Statutory funds", "funds.cdf", "Community development fund", -(await glBalance("community_development_fund", end, db)), true);
  add("Statutory funds", "funds.optional", "Optional fund", -(await glBalance("optional_fund", end, db)), true);
  add("Statutory funds", "funds.cdf_utilized", "CDF used in the year", await usedInYear("community_development_fund", start, end, db), true);
  add("Statutory funds", "funds.cetf_payable", "CETF payable at year end", -(await glBalance("cetf_payable", end, db)), true);
  add("Statutory funds", "funds.cetf_remitted", "CETF remitted in the year", await usedInYear("cetf_payable", start, end, db), true);

  const officers = await listOfficers(end, db);
  add("Officers and trainings", "officers.count", "Officers serving at year end", officers.length);
  add("Officers and trainings", "officers.trained", "Officers with a training in the year", [...(await officerTrainingHours(start, end, db)).keys()].filter((id) => officers.some((o) => o.memberId === id)).length);
  return out;
}

const TEMPLATE_DIR = path.join(process.cwd(), "docs", "cda-templates");
const templatePath = (t: CdaTemplate, dir = TEMPLATE_DIR) => path.join(dir, t.file);

/** Whether each CDA template is in docs/cda-templates/ (the CDA reports page). */
export function templateStatus() {
  return CDA_TEMPLATES.map((t) => ({ key: t.key, title: t.title, file: `docs/cda-templates/${t.file}`, found: existsSync(templatePath(t)), mapped: t.fields.filter((f) => f.source).length, unmapped: t.fields.filter((f) => !f.source).length }));
}

const PESO = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

/**
 * The CAPR workbook: a cover, the CAPR template filled where it is mapped (otherwise the MIS's data
 * sheets), the officers and trainings, and "Unmapped fields": template fields with no MIS source,
 * or a note that the template hasn't been provided yet.
 */
export async function caprWorkbook(year: number, db: Db | Tx = getDb(), opts: { templates?: CdaTemplate[]; dir?: string } = {}): Promise<Buffer> {
  const data = await caprData(year, db);
  const byKey = new Map(data.map((f) => [f.key, f]));
  const template = (opts.templates ?? CDA_TEMPLATES).find((t) => t.key === "CAPR");
  if (!template) throw new Error("no CAPR template configured");
  const file = templatePath(template, opts.dir);
  const wb = new ExcelJS.Workbook();
  const unmapped: Array<[string, string, string, string, string]> = [];
  if (existsSync(file)) {
    await wb.xlsx.readFile(file);
    for (const f of template.fields) {
      const value = f.source ? byKey.get(f.source) : undefined;
      if (!value) {
        unmapped.push([template.title, f.sheet, f.cell, f.label, f.source ? `No value for ${f.source}` : "No source in the MIS"]);
        continue;
      }
      const ws = wb.getWorksheet(f.sheet);
      if (!ws) {
        unmapped.push([template.title, f.sheet, f.cell, f.label, "The template has no such sheet"]);
        continue;
      }
      ws.getCell(f.cell).value = typeof value.value === "bigint" ? pesos(value.value) : value.value;
    }
  } else {
    unmapped.push([template.title, "", "", "(whole template)", `docs/cda-templates/${template.file} hasn't been provided yet; the data sheets below hold every figure the MIS can give`]);
  }
  wb.creator = "PCMPC MIS";

  // The MIS's own sheets never clash with a template's sheet names.
  const sheetName = (name: string) => (wb.getWorksheet(name) ? `${name} (MIS)` : name);
  const cover = wb.addWorksheet(sheetName("Cover"));
  cover.getColumn(1).width = 34;
  cover.getColumn(2).width = 60;
  cover.addRow([String(byKey.get("coop.name")?.value ?? "")]).font = { bold: true, size: 13 };
  cover.addRow([`CDA annual report data, fiscal year ${year}`]).font = { bold: true };
  cover.addRow([]);
  for (const key of ["coop.cda_reg_no", "coop.tin", "coop.address", "report.year", "report.period"]) {
    const f = byKey.get(key);
    if (f) cover.addRow([f.label, typeof f.value === "bigint" ? pesos(f.value) : f.value]);
  }
  const { end: fyEnd } = await fiscalYear(year, db);
  cover.addRow(["Due to the CDA", `${formatDate(addDays(fyEnd, 120))} (120 days after the fiscal year ends)`]);
  cover.addRow(["Generated", formatDateTime(now())]);

  const sheet = wb.addWorksheet(sheetName("CAPR data"));
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 52;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 30;
  sheet.addRow(["Section", "Field", "Value", "Key"]).font = { bold: true };
  for (const f of data) {
    const row = sheet.addRow([f.section, f.label, typeof f.value === "bigint" ? pesos(f.value) : f.value, f.key]);
    if (typeof f.value === "bigint") row.getCell(3).numFmt = PESO;
  }

  const { end, start } = await fiscalYear(year, db);
  const officers = await listOfficers(end, db);
  const hours = await officerTrainingHours(start, end, db);
  const os = wb.addWorksheet(sheetName("Officers and trainings"));
  os.columns = [{ width: 34 }, { width: 22 }, { width: 12 }, { width: 34 }, { width: 8 }, { width: 26 }, { width: 14 }, { width: 12 }].map((c) => ({ ...c }));
  os.addRow(["Board or committee", "Position", "Member no.", "Name", "Sex", "Term", "Training hours", "Trainings"]).font = { bold: true };
  for (const o of officers) {
    const h = hours.get(o.memberId);
    os.addRow([o.committeeName, o.position, o.memberNo ?? "", o.name, o.sex === "FEMALE" ? "F" : "M", `${formatDate(o.termStart)} to ${o.termEnd ? formatDate(o.termEnd) : "present"}`, h ? Number(h.hours) : 0, h?.trainings ?? 0]);
  }

  const un = wb.addWorksheet(sheetName("Unmapped fields"));
  un.columns = [{ width: 40 }, { width: 16 }, { width: 8 }, { width: 30 }, { width: 80 }];
  un.addRow(["Template", "Sheet", "Cell", "Field", "Why"]).font = { bold: true };
  for (const u of unmapped) un.addRow(u);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
