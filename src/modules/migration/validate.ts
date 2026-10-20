import Decimal from "decimal.js";
import { and, eq, notInArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { addDays, businessToday, formatDate, isBusinessDate, type BusinessDate } from "@/lib/dates";
import { format, parse, type Money } from "@/lib/money";
import { nameKey } from "@/lib/names";
import { accounts } from "@/modules/ledger/schema";
import { schedule, type AmortizationMethod } from "@/modules/loans/amortization";
import { loanProducts, loans } from "@/modules/loans/schema";
import { MEMBER_TYPES, members } from "@/modules/members/schema";
import { CIVIL_STATUSES, memberInputSchema, SEXES } from "@/modules/members/validation";
import { depositAccounts, depositProducts, timeDeposits } from "@/modules/savings/schema";
import { getSetting } from "@/modules/settings/service";
import { shareTransactions } from "@/modules/share/schema";
import { products, suppliers } from "@/modules/store/schema";
import { CLASSIFICATIONS, waterAccounts, waterBillingPeriods, waterBills, waterCustomers, waterMeters, waterRateSchedules, waterRoutes, waterZones } from "@/modules/water/schema";
import type { RawRow, RowError } from "./parse";
import { importBatches, stgMembers, stgSavings, stgWaterAccounts, type MigrationEntity, type STAGING } from "./schema";

/**
 * The dry-run checks (PHASE-17 T17.3): every cell of every row, then the rows against each other
 * (duplicates), against the MIS (numbers already used, codes that don't exist) and against the
 * files already staged for the same cut-off (a savings account's member must be in the staged
 * Members file or already in the MIS). Nothing is written here.
 */

export type StgInsert<E extends MigrationEntity> = Omit<(typeof STAGING)[E]["$inferInsert"], "id" | "batchId" | "createdAt" | "createdBy">;
export type Validated = { [E in MigrationEntity]: { entity: E; rows: StgInsert<E>[] } }[MigrationEntity];

const REQUIRED = "Required";
const DATE_MSG = "Not a valid date (use YYYY-MM-DD)";

/** Amount text → centavos; Excel's float noise (1180.4999999999998) is read as the 2-decimal amount it stands for. */
function toMoney(text: string): Money | undefined {
  let t = text.replace(/\s/g, "");
  if (/^-?\d+\.\d{3,}$/.test(t)) {
    const n = Number(t);
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return undefined;
    t = n.toFixed(2);
  }
  try {
    return parse(t);
  } catch {
    return undefined;
  }
}

/** One row's cells, read with the template's rules; each problem is recorded against its column. */
class Cells {
  ok = true;
  constructor(
    readonly raw: RawRow,
    private readonly errors: RowError[],
  ) {}

  get rowNo(): number {
    return this.raw.rowNo;
  }

  fail(column: string, message: string): null {
    this.errors.push({ row: this.raw.rowNo, column, message });
    this.ok = false;
    return null;
  }

  private get(h: string): string {
    return this.raw.cells[h] ?? "";
  }

  text(h: string, required = false, max = 200): string | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (v.length > max) return this.fail(h, `At most ${max} characters`);
    return v;
  }

  /** A code or number (member no., account no., SKU…): compared without regard to case. */
  id(h: string, required = false): string | null {
    const v = this.text(h, required, 60);
    return v === null ? null : v.toUpperCase();
  }

  date(h: string, required = false): BusinessDate | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !isBusinessDate(v)) return this.fail(h, DATE_MSG);
    return v;
  }

  money(h: string, required = false): Money | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    const amount = toMoney(v);
    if (amount === undefined) return this.fail(h, "Not an amount (a plain number with up to 2 decimals)");
    if (amount < 0n) return this.fail(h, "Can't be negative");
    return amount;
  }

  int(h: string, required = false, min = 0, max?: number): number | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (!/^-?\d+$/.test(v)) return this.fail(h, "Not a whole number");
    const n = Number(v);
    if (n < min || (max !== undefined && n > max)) return this.fail(h, max === undefined ? `At least ${min}` : `From ${min} to ${max}`);
    return n;
  }

  /** A rate in percent → the decimal fraction the MIS stores ("1.5" → "0.015"). */
  percent(h: string, required = false): string | null {
    const v = this.get(h).replace("%", "").trim();
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    let d: Decimal;
    try {
      d = new Decimal(v);
    } catch {
      return this.fail(h, "Not a number (e.g. 1.5 for 1.5%)");
    }
    if (!d.isFinite() || d.lte(0) || d.gte(100)) return this.fail(h, "Enter the rate in percent, above 0 and below 100");
    if (d.decimalPlaces() > 4) return this.fail(h, "Use at most 4 decimals");
    return d.div(100).toString();
  }

  /** A unit cost in pesos with up to 4 decimals, as the stock cards keep it. */
  cost(h: string, required = false): string | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    let d: Decimal;
    try {
      d = new Decimal(v.replace(/[₱,\s]/g, ""));
    } catch {
      return this.fail(h, "Not an amount");
    }
    if (!d.isFinite() || d.lt(0)) return this.fail(h, "Can't be negative");
    if (d.decimalPlaces() > 4) {
      const r = d.toDecimalPlaces(4);
      if (d.minus(r).abs().gt("0.000000001")) return this.fail(h, "Use at most 4 decimals");
      d = r;
    }
    return d.toFixed(4);
  }

  choice<T extends string>(h: string, values: readonly T[], required = false): T | null {
    const v = this.get(h).toUpperCase();
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (!(values as readonly string[]).includes(v)) return this.fail(h, `Use one of: ${values.join(", ")}`);
    return v as T;
  }

  yesno(h: string, required = false): boolean | null {
    const v = this.get(h).toUpperCase();
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (["YES", "Y", "TRUE"].includes(v)) return true;
    if (["NO", "N", "FALSE"].includes(v)) return false;
    return this.fail(h, "Use YES or NO");
  }

  period(h: string, required = false): string | null {
    const v = this.get(h);
    if (!v) return required ? this.fail(h, REQUIRED) : null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return this.fail(h, "Not a month (use YYYY-MM)");
    return v;
  }
}

/** Marks the second and later rows with the same key as duplicates of the first. Returns whether this row is one. */
function duplicate(seen: Map<string, number>, key: string | null, c: Cells, column: string): boolean {
  if (key === null) return false;
  const first = seen.get(key);
  if (first !== undefined) {
    c.fail(column, `Duplicate of row ${first}`);
    return true;
  }
  seen.set(key, c.rowNo);
  return false;
}

type Ctx = { tx: Tx; cutoff: BusinessDate };

const stagedFor = (cutoff: BusinessDate) => and(eq(importBatches.status, "STAGED"), eq(importBatches.cutoffDate, cutoff));

/** Rows of the Members, Savings and Water accounts files staged for the cut-off. */
const stagedMembers = (tx: Tx, cutoff: BusinessDate) =>
  tx.select({ row: stgMembers }).from(stgMembers).innerJoin(importBatches, eq(importBatches.id, stgMembers.batchId)).where(stagedFor(cutoff));
const stagedSavings = (tx: Tx, cutoff: BusinessDate) =>
  tx.select({ row: stgSavings }).from(stgSavings).innerJoin(importBatches, eq(importBatches.id, stgSavings.batchId)).where(stagedFor(cutoff));
const stagedWaterAccounts = (tx: Tx, cutoff: BusinessDate) =>
  tx.select({ row: stgWaterAccounts }).from(stgWaterAccounts).innerJoin(importBatches, eq(importBatches.id, stgWaterAccounts.batchId)).where(stagedFor(cutoff));

/** Member numbers known for the cut-off: the staged Members file and the members already in the MIS. */
async function memberRefs(ctx: Ctx) {
  const refs = new Map<string, { live: boolean; status: string }>();
  for (const { row } of await stagedMembers(ctx.tx, ctx.cutoff)) refs.set(row.memberNo, { live: false, status: row.status });
  for (const m of await ctx.tx.select({ no: members.memberNo, status: members.status }).from(members)) if (m.no) refs.set(m.no.toUpperCase(), { live: true, status: m.status });
  return refs;
}

type Refs = Awaited<ReturnType<typeof memberRefs>>;

function memberOf(c: Cells, refs: Refs, h = "Member No."): string | null {
  const no = c.id(h, true);
  if (!no) return null;
  const ref = refs.get(no);
  if (!ref) return c.fail(h, "No member with this no. (stage the Members file first)");
  if (!["ACTIVE", "INACTIVE"].includes(ref.status)) return c.fail(h, `This member is ${ref.status.toLowerCase()} in the MIS`);
  return no;
}

const afterCutoff = (c: Cells, h: string, date: BusinessDate | null, ctx: Ctx) => {
  if (date && date > ctx.cutoff) c.fail(h, `After the cut-off (${formatDate(ctx.cutoff)})`);
};

/** memberInputSchema's fields → the template's columns (for its format checks: mobile, e-mail, lengths). */
const MEMBER_FIELDS: Record<string, string> = {
  type: "Type",
  lastName: "Last Name",
  firstName: "First Name",
  middleName: "Middle Name",
  suffix: "Suffix",
  birthdate: "Birthdate",
  sex: "Sex",
  civilStatus: "Civil Status",
  addrStreet: "House No. / Street",
  addrPurok: "Purok / Sitio",
  addrBarangay: "Barangay",
  addrMunicipality: "Municipality",
  addrProvince: "Province",
  mobile: "Mobile",
  email: "Email",
  occupation: "Occupation",
  tin: "TIN",
  pmesDate: "PMES Date",
  bodResolutionNo: "BOD Resolution No.",
};

async function vMembers(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"members">[]> {
  const liveNos = new Set((await ctx.tx.select({ no: members.memberNo }).from(members)).flatMap((m) => (m.no ? [m.no.toUpperCase()] : [])));
  const livePeople = new Map(
    (
      await ctx.tx
        .select({ no: members.memberNo, nameKey: members.nameKey, birthdate: members.birthdate, last: members.lastName, first: members.firstName })
        .from(members)
        .where(notInArray(members.status, ["TERMINATED", "DECEASED"]))
    ).map((m) => [`${m.nameKey}|${m.birthdate}`, m.no ?? `${m.last}, ${m.first} (applicant)`]),
  );
  const seenNo = new Map<string, number>();
  const seenPerson = new Map<string, number>();
  const out: StgInsert<"members">[] = [];
  for (const c of rows) {
    const memberNo = c.id("Member No.", true);
    const dupNo = duplicate(seenNo, memberNo, c, "Member No.");
    if (memberNo && !dupNo && liveNos.has(memberNo)) c.fail("Member No.", "Already in the MIS");
    const v = {
      type: c.choice("Type", MEMBER_TYPES, true),
      status: c.choice("Status", ["ACTIVE", "INACTIVE"] as const, true),
      lastName: c.text("Last Name", true, 80),
      firstName: c.text("First Name", true, 80),
      middleName: c.text("Middle Name", false, 80),
      suffix: c.text("Suffix", false, 10),
      birthdate: c.date("Birthdate", true),
      sex: c.choice("Sex", SEXES, true),
      civilStatus: c.choice("Civil Status", CIVIL_STATUSES, true),
      addrStreet: c.text("House No. / Street"),
      addrPurok: c.text("Purok / Sitio", false, 80),
      addrBarangay: c.text("Barangay", true, 80),
      addrMunicipality: c.text("Municipality", true, 80),
      addrProvince: c.text("Province", true, 80),
      mobile: c.text("Mobile", false, 20),
      email: c.text("Email"),
      occupation: c.text("Occupation", false, 120),
      tin: c.text("TIN", false, 20),
      membershipDate: c.date("Membership Date", true),
      pmesDate: c.date("PMES Date"),
      bodResolutionNo: c.text("BOD Resolution No.", false, 40),
      membershipFee: c.money("Membership Fee Paid") ?? 0n,
    };
    afterCutoff(c, "Membership Date", v.membershipDate, ctx);
    afterCutoff(c, "PMES Date", v.pmesDate, ctx);
    if (v.birthdate && v.birthdate > (v.membershipDate ?? ctx.cutoff)) c.fail("Birthdate", "After the membership date");
    if (c.ok) {
      // The members module's own format rules (mobile, e-mail).
      const parsed = memberInputSchema.safeParse({ ...v, employer: null, validIdType: null, validIdNo: null, remarks: null, privacyConsent: true });
      if (!parsed.success) for (const issue of parsed.error.issues) c.fail(MEMBER_FIELDS[String(issue.path[0])] ?? "(row)", issue.message);
    }
    if (!dupNo && v.lastName && v.firstName && v.birthdate) {
      const key = `${nameKey(v.lastName, v.firstName)}|${v.birthdate}`;
      const first = seenPerson.get(key);
      if (first !== undefined) c.fail("Last Name", `Same name and birthdate as row ${first}`);
      else {
        seenPerson.set(key, c.rowNo);
        const live = livePeople.get(key);
        if (live) c.fail("Last Name", `Same name and birthdate as ${live} in the MIS`);
      }
    }
    if (
      c.ok &&
      memberNo &&
      v.type &&
      v.status &&
      v.lastName &&
      v.firstName &&
      v.birthdate &&
      v.sex &&
      v.civilStatus &&
      v.addrBarangay &&
      v.addrMunicipality &&
      v.addrProvince &&
      v.membershipDate
    ) {
      out.push({
        ...v,
        rowNo: c.rowNo,
        memberNo,
        type: v.type,
        status: v.status,
        lastName: v.lastName,
        firstName: v.firstName,
        birthdate: v.birthdate,
        sex: v.sex,
        civilStatus: v.civilStatus,
        addrBarangay: v.addrBarangay,
        addrMunicipality: v.addrMunicipality,
        addrProvince: v.addrProvince,
        membershipDate: v.membershipDate,
      });
    }
  }
  return out;
}

async function vShareCapital(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"share_capital">[]> {
  const refs = await memberRefs(ctx);
  const par = BigInt(await getSetting("share.par_value", ctx.tx));
  const withShares = new Set(
    (await ctx.tx.selectDistinct({ no: members.memberNo }).from(shareTransactions).innerJoin(members, eq(members.id, shareTransactions.memberId))).flatMap((m) =>
      m.no ? [m.no.toUpperCase()] : [],
    ),
  );
  const seen = new Map<string, number>();
  const out: StgInsert<"share_capital">[] = [];
  for (const c of rows) {
    const memberNo = memberOf(c, refs);
    if (!duplicate(seen, memberNo, c, "Member No.") && memberNo && withShares.has(memberNo)) c.fail("Member No.", "Already has share capital in the MIS");
    const subscribed = c.money("Subscribed", true);
    const paidUp = c.money("Paid-up", true);
    if (subscribed !== null && subscribed === 0n) c.fail("Subscribed", "Must be more than 0");
    else if (subscribed !== null && subscribed % par !== 0n) c.fail("Subscribed", `Not a whole number of shares (par value ${format(par)})`);
    if (subscribed !== null && paidUp !== null && paidUp > subscribed) c.fail("Paid-up", "More than the subscribed amount");
    if (c.ok && memberNo && subscribed !== null && paidUp !== null) out.push({ rowNo: c.rowNo, memberNo, subscribed, paidUp });
  }
  return out;
}

async function vSavings(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"savings">[]> {
  const refs = await memberRefs(ctx);
  const productsByCode = new Map((await ctx.tx.select().from(depositProducts).where(eq(depositProducts.kind, "SAVINGS"))).map((p) => [p.code.toUpperCase(), p]));
  const live = await ctx.tx
    .select({ accountNo: depositAccounts.accountNo, memberNo: members.memberNo, productCode: depositProducts.code, status: depositAccounts.status })
    .from(depositAccounts)
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId));
  const liveNos = new Set(live.map((a) => a.accountNo.toUpperCase()));
  const liveOpen = new Set(live.filter((a) => a.status !== "CLOSED").map((a) => `${a.memberNo?.toUpperCase()}|${a.productCode.toUpperCase()}`));
  const seenNo = new Map<string, number>();
  const seenHolder = new Map<string, number>();
  const out: StgInsert<"savings">[] = [];
  for (const c of rows) {
    const memberNo = memberOf(c, refs);
    const accountNo = c.id("Account No.");
    if (!duplicate(seenNo, accountNo, c, "Account No.") && accountNo && liveNos.has(accountNo)) c.fail("Account No.", "Already in the MIS");
    const productCode = c.id("Product Code", true);
    if (productCode && !productsByCode.has(productCode)) c.fail("Product Code", `No savings product ${productCode} in the MIS`);
    if (memberNo && productCode) {
      const holder = `${memberNo}|${productCode}`;
      const first = seenHolder.get(holder);
      if (first !== undefined) c.fail("Member No.", `The member already has a ${productCode} account in row ${first}`);
      else {
        seenHolder.set(holder, c.rowNo);
        if (liveOpen.has(holder)) c.fail("Member No.", `The member already has a ${productCode} account in the MIS`);
      }
    }
    const openedOn = c.date("Opened On", true);
    afterCutoff(c, "Opened On", openedOn, ctx);
    const balance = c.money("Balance", true);
    const lastTxnDate = c.date("Last Transaction Date");
    afterCutoff(c, "Last Transaction Date", lastTxnDate, ctx);
    if (c.ok && memberNo && productCode && openedOn && balance !== null) out.push({ rowNo: c.rowNo, memberNo, accountNo, productCode, openedOn, balance, lastTxnDate });
  }
  return out;
}

/** The savings account a time deposit pays into: the one named, or the member's only savings account (staged or in the MIS). */
export async function savingsAccountsFor(tx: Tx, cutoff: BusinessDate) {
  const staged = (await stagedSavings(tx, cutoff)).map(({ row }) => ({ memberNo: row.memberNo, accountNo: row.accountNo, live: false }));
  const live = await tx
    .select({ memberNo: members.memberNo, accountNo: depositAccounts.accountNo })
    .from(depositAccounts)
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
    .where(and(eq(depositProducts.kind, "SAVINGS"), notInArray(depositAccounts.status, ["CLOSED"])));
  const byMember = new Map<string, Array<{ accountNo: string | null; live: boolean }>>();
  for (const a of [...staged, ...live.map((l) => ({ memberNo: (l.memberNo ?? "").toUpperCase(), accountNo: l.accountNo.toUpperCase(), live: true }))]) {
    byMember.set(a.memberNo, [...(byMember.get(a.memberNo) ?? []), { accountNo: a.accountNo, live: a.live }]);
  }
  return byMember;
}

async function vTimeDeposits(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"time_deposits">[]> {
  const refs = await memberRefs(ctx);
  const [tdProduct] = await ctx.tx.select().from(depositProducts).where(and(eq(depositProducts.kind, "TIME"), eq(depositProducts.active, true))).limit(1);
  const accountsOf = await savingsAccountsFor(ctx.tx, ctx.cutoff);
  const liveCerts = new Set((await ctx.tx.select({ no: timeDeposits.certificateNo }).from(timeDeposits)).map((t) => t.no.toUpperCase()));
  const seen = new Map<string, number>();
  const out: StgInsert<"time_deposits">[] = [];
  for (const c of rows) {
    if (!tdProduct) c.fail("(row)", "No time deposit product in the MIS");
    const memberNo = memberOf(c, refs);
    const certificateNo = c.id("Certificate No.");
    if (!duplicate(seen, certificateNo, c, "Certificate No.") && certificateNo && liveCerts.has(certificateNo)) c.fail("Certificate No.", "Already in the MIS");
    const principal = c.money("Principal", true);
    if (principal === 0n) c.fail("Principal", "Must be more than 0");
    const ratePa = c.percent("Rate p.a. (%)", true);
    const termDays = c.int("Term (days)", true, 1, 3660);
    const placementDate = c.date("Placement Date", true);
    afterCutoff(c, "Placement Date", placementDate, ctx);
    const given = c.date("Maturity Date");
    const maturityDate = placementDate && termDays ? addDays(placementDate, termDays) : null;
    if (given && maturityDate && given !== maturityDate) c.fail("Maturity Date", `Placement date + term is ${formatDate(maturityDate)}`);
    const savingsAccountNo = c.id("Savings Account No.");
    if (memberNo) {
      const own = accountsOf.get(memberNo) ?? [];
      if (savingsAccountNo) {
        if (!own.some((a) => a.accountNo === savingsAccountNo)) c.fail("Savings Account No.", "Not a savings account of this member (in the Savings file or the MIS)");
      } else if (own.length === 0) c.fail("Savings Account No.", "The member has no savings account (stage the Savings file first)");
      else if (own.length > 1) c.fail("Savings Account No.", "The member has several savings accounts; enter the account no.");
    }
    if (c.ok && memberNo && principal !== null && ratePa && termDays && placementDate && maturityDate) {
      out.push({ rowNo: c.rowNo, memberNo, certificateNo, principal, ratePa, termDays, placementDate, maturityDate, savingsAccountNo });
    }
  }
  return out;
}

/** The schedule balance check of a migrated loan; null when it fits, otherwise the message. */
export function loanBalanceProblem(input: { principal: Money; ratePm: string; term: number; method: AmortizationMethod; firstDueDate: BusinessDate; installmentsPaid: number; outstanding: Money }): string | null {
  const rows = schedule({ principal: input.principal, ratePm: input.ratePm, term: input.term, method: input.method, firstDueDate: input.firstDueDate });
  const after = rows.slice(input.installmentsPaid).reduce((s, r) => s + r.principal, 0n);
  const next = rows[input.installmentsPaid]?.principal ?? 0n;
  if (input.outstanding <= after && input.outstanding > after - next) return null;
  return `After ${input.installmentsPaid} installment(s) the schedule's balance is ${format(after)}: the outstanding principal must be that, or less by part of installment ${input.installmentsPaid + 1}'s principal (${format(next)})`;
}

async function vLoans(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"loans">[]> {
  const refs = await memberRefs(ctx);
  const productsByCode = new Map((await ctx.tx.select().from(loanProducts)).map((p) => [p.code.toUpperCase(), p]));
  const liveNos = new Set((await ctx.tx.select({ no: loans.loanNo }).from(loans)).map((l) => l.no.toUpperCase()));
  const seen = new Map<string, number>();
  const out: StgInsert<"loans">[] = [];
  for (const c of rows) {
    const memberNo = memberOf(c, refs);
    const loanNo = c.id("Loan No.");
    if (!duplicate(seen, loanNo, c, "Loan No.") && loanNo && liveNos.has(loanNo)) c.fail("Loan No.", "Already in the MIS");
    const productCode = c.id("Product Code", true);
    const product = productCode ? productsByCode.get(productCode) : undefined;
    if (productCode && !product) c.fail("Product Code", `No loan product ${productCode} in the MIS`);
    const principal = c.money("Principal", true);
    if (principal === 0n) c.fail("Principal", "Must be more than 0");
    const term = c.int("Term (months)", true, 1, 360);
    const ratePm = c.percent("Rate per Month (%)") ?? product?.ratePm ?? null;
    const releaseDate = c.date("Release Date", true);
    afterCutoff(c, "Release Date", releaseDate, ctx);
    const firstDueDate = c.date("First Due Date", true);
    if (releaseDate && firstDueDate && firstDueDate <= releaseDate) c.fail("First Due Date", "On or before the release date");
    const installmentsPaid = c.int("Installments Paid", true, 0);
    if (term !== null && installmentsPaid !== null && installmentsPaid >= term) c.fail("Installments Paid", "Every installment is paid: a paid loan isn't migrated");
    const outstanding = c.money("Outstanding Principal", true);
    if (outstanding === 0n) c.fail("Outstanding Principal", "Must be more than 0");
    const unpaidPenalty = c.money("Unpaid Penalty") ?? 0n;
    if (c.ok && product && principal !== null && term !== null && ratePm && firstDueDate && installmentsPaid !== null && outstanding !== null) {
      const problem = loanBalanceProblem({ principal, ratePm, term, method: product.method, firstDueDate, installmentsPaid, outstanding });
      if (problem) c.fail("Outstanding Principal", problem);
    }
    if (c.ok && memberNo && productCode && principal !== null && term !== null && ratePm && releaseDate && firstDueDate && installmentsPaid !== null && outstanding !== null) {
      out.push({ rowNo: c.rowNo, memberNo, loanNo, productCode, principal, term, ratePm, releaseDate, firstDueDate, installmentsPaid, outstandingPrincipal: outstanding, unpaidPenalty });
    }
  }
  return out;
}

async function vWaterAccounts(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"water_accounts">[]> {
  const refs = await memberRefs(ctx);
  const routes = await ctx.tx.select({ zone: waterZones.code, route: waterRoutes.code }).from(waterRoutes).innerJoin(waterZones, eq(waterZones.id, waterRoutes.zoneId));
  const zones = new Set(routes.map((r) => r.zone.toUpperCase()));
  const zoneOfRoute = new Map(routes.map((r) => [r.route.toUpperCase(), r.zone.toUpperCase()]));
  for (const z of await ctx.tx.select({ code: waterZones.code }).from(waterZones)) zones.add(z.code.toUpperCase());
  const priced = new Set((await ctx.tx.selectDistinct({ c: waterRateSchedules.classification }).from(waterRateSchedules)).map((r) => r.c));
  const liveAccounts = new Set((await ctx.tx.select({ no: waterAccounts.accountNo }).from(waterAccounts)).map((a) => a.no.toUpperCase()));
  const liveCustomers = new Set((await ctx.tx.select({ no: waterCustomers.customerNo }).from(waterCustomers)).map((a) => a.no.toUpperCase()));
  const liveMemberCustomers = new Set(
    (await ctx.tx.select({ no: members.memberNo }).from(waterCustomers).innerJoin(members, eq(members.id, waterCustomers.memberId))).flatMap((m) => (m.no ? [m.no.toUpperCase()] : [])),
  );
  const liveMeters = new Set((await ctx.tx.select({ no: waterMeters.serialNo }).from(waterMeters)).map((m) => m.no.toUpperCase()));
  const seenAccount = new Map<string, number>();
  const seenMeter = new Map<string, number>();
  const customers = new Map<string, { row: number; who: string }>();
  const out: StgInsert<"water_accounts">[] = [];
  for (const c of rows) {
    const accountNo = c.id("Account No.", true);
    if (!duplicate(seenAccount, accountNo, c, "Account No.") && accountNo && liveAccounts.has(accountNo)) c.fail("Account No.", "Already in the MIS");
    const customerNo = c.id("Customer No.");
    const memberNo = c.text("Member No.") ? memberOf(c, refs) : null;
    const lastName = c.text("Last Name", false, 80);
    const firstName = c.text("First Name", false, 80);
    const middleName = c.text("Middle Name", false, 80);
    const businessName = c.text("Business Name", false, 120);
    if (!memberNo && !businessName && !(lastName && firstName)) c.fail("Last Name", "Enter the member no., the last and first name, or the business name");
    // Rows of one customer must agree on who the customer is.
    const who = [memberNo, lastName, firstName, businessName].map((v) => (v ?? "").toUpperCase()).join("|");
    const key = customerNo ?? (memberNo ? `member:${memberNo}` : null);
    if (key) {
      const first = customers.get(key);
      if (first && first.who !== who) c.fail(customerNo ? "Customer No." : "Member No.", `Row ${first.row} has this customer with a different name or member no.`);
      if (!first) {
        customers.set(key, { row: c.rowNo, who });
        if (customerNo && liveCustomers.has(customerNo)) c.fail("Customer No.", "Already in the MIS");
        if (memberNo && liveMemberCustomers.has(memberNo)) c.fail("Member No.", "Already a water customer in the MIS");
      }
    }
    const customerAddress = c.text("Customer Address", true);
    const mobile = c.text("Mobile", false, 20);
    const classification = c.choice("Classification", CLASSIFICATIONS, true);
    if (classification && !priced.has(classification)) c.fail("Classification", `No ${classification} tariff in the MIS yet`);
    const zoneCode = c.id("Zone Code", true);
    if (zoneCode && !zones.has(zoneCode)) c.fail("Zone Code", "No such zone (Water › Zones & routes)");
    const routeCode = c.id("Route Code", true);
    if (routeCode && zoneCode && zones.has(zoneCode) && zoneOfRoute.get(routeCode) !== zoneCode) c.fail("Route Code", `No route ${routeCode} in zone ${zoneCode}`);
    const sequenceNo = c.int("Sequence", false, 1);
    const serviceAddress = c.text("Service Address", true);
    const status = c.choice("Status", ["ACTIVE", "DISCONNECTED"] as const, true);
    const connectedOn = c.date("Connected On", true);
    afterCutoff(c, "Connected On", connectedOn, ctx);
    const meterSerial = c.id("Meter Serial No.", true);
    if (!duplicate(seenMeter, meterSerial, c, "Meter Serial No.") && meterSerial && liveMeters.has(meterSerial)) c.fail("Meter Serial No.", "Already in the MIS");
    const lastReading = c.int("Last Reading", true, 0);
    const givenDigits = c.int("Meter Digits", false, 3, 9);
    const meterDigits = givenDigits ?? Math.max(4, String(lastReading ?? 0).length);
    if (lastReading !== null && lastReading >= 10 ** meterDigits) c.fail("Last Reading", `Doesn't fit a ${meterDigits}-digit meter`);
    const consumption1 = c.int("Consumption 1 Month Ago", false, 0);
    const consumption2 = c.int("Consumption 2 Months Ago", false, 0);
    const consumption3 = c.int("Consumption 3 Months Ago", false, 0);
    const deposit = c.money("Meter Deposit") ?? 0n;
    const advance = c.money("Advance Payment") ?? 0n;
    if (c.ok && accountNo && customerAddress && classification && zoneCode && routeCode && serviceAddress && status && connectedOn && meterSerial && lastReading !== null) {
      out.push({
        rowNo: c.rowNo,
        accountNo,
        customerNo,
        memberNo,
        lastName,
        firstName,
        middleName,
        businessName,
        customerAddress,
        mobile,
        classification,
        zoneCode,
        routeCode,
        sequenceNo,
        serviceAddress,
        status,
        connectedOn,
        meterSerial,
        meterDigits,
        lastReading,
        consumption1,
        consumption2,
        consumption3,
        deposit,
        advance,
      });
    }
  }
  return out;
}

async function vWaterBills(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"water_bills">[]> {
  const known = new Set((await stagedWaterAccounts(ctx.tx, ctx.cutoff)).map(({ row }) => row.accountNo));
  for (const a of await ctx.tx.select({ no: waterAccounts.accountNo }).from(waterAccounts)) known.add(a.no.toUpperCase());
  const liveBills = await ctx.tx
    .select({ billNo: waterBills.billNo, accountNo: waterAccounts.accountNo, period: waterBillingPeriods.period })
    .from(waterBills)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId));
  const liveBillNos = new Set(liveBills.map((b) => b.billNo.toUpperCase()));
  const livePeriods = new Set(liveBills.map((b) => `${b.accountNo.toUpperCase()}|${b.period}`));
  const seenBillNo = new Map<string, number>();
  const seenPeriod = new Map<string, number>();
  const cutoffMonth = ctx.cutoff.slice(0, 7);
  const out: StgInsert<"water_bills">[] = [];
  for (const c of rows) {
    const accountNo = c.id("Account No.", true);
    if (accountNo && !known.has(accountNo)) c.fail("Account No.", "No such water account (stage the Water accounts file first)");
    const billNo = c.id("Bill No.");
    if (!duplicate(seenBillNo, billNo, c, "Bill No.") && billNo && liveBillNos.has(billNo)) c.fail("Bill No.", "Already in the MIS");
    const period = c.period("Period", true);
    if (period && period > cutoffMonth) c.fail("Period", `After the cut-off month (${cutoffMonth})`);
    if (accountNo && period && !duplicate(seenPeriod, `${accountNo}|${period}`, c, "Period") && livePeriods.has(`${accountNo}|${period}`)) c.fail("Period", "This account already has a bill for this period in the MIS");
    const billDate = c.date("Bill Date", true);
    afterCutoff(c, "Bill Date", billDate, ctx);
    const dueDate = c.date("Due Date", true);
    if (billDate && dueDate && dueDate < billDate) c.fail("Due Date", "Before the bill date");
    const consumption = c.int("Consumption", false, 0);
    const amount = c.money("Amount Unpaid", true);
    if (amount === 0n) c.fail("Amount Unpaid", "Must be more than 0 (paid bills aren't migrated)");
    const penaltyAssessed = c.yesno("Penalty Assessed", true);
    if (c.ok && accountNo && period && billDate && dueDate && amount !== null && penaltyAssessed !== null) {
      out.push({ rowNo: c.rowNo, accountNo, billNo, period, billDate, dueDate, consumption, amount, penaltyAssessed });
    }
  }
  return out;
}

async function vStoreStock(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"store_stock">[]> {
  const live = await ctx.tx.select({ sku: products.sku, barcode: products.barcode }).from(products);
  const liveSkus = new Set(live.map((p) => p.sku.toUpperCase()));
  const liveBarcodes = new Set(live.flatMap((p) => (p.barcode ? [p.barcode.toUpperCase()] : [])));
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const out: StgInsert<"store_stock">[] = [];
  for (const c of rows) {
    const sku = c.id("SKU", true);
    if (!duplicate(seenSku, sku, c, "SKU") && sku && liveSkus.has(sku)) c.fail("SKU", "Already in the MIS");
    const barcode = c.id("Barcode");
    if (!duplicate(seenBarcode, barcode, c, "Barcode") && barcode && liveBarcodes.has(barcode)) c.fail("Barcode", "Already in the MIS");
    const name = c.text("Name", true, 120);
    const unit = c.text("Unit", true, 20);
    const category = c.text("Category", false, 60);
    const sellingPrice = c.money("Selling Price", true);
    const unitCost = c.cost("Unit Cost", true);
    const quantity = c.int("Quantity", true, 0);
    const reorderLevel = c.int("Reorder Level", false, 0) ?? 0;
    if (c.ok && sku && name && unit && sellingPrice !== null && unitCost && quantity !== null) {
      out.push({ rowNo: c.rowNo, sku, barcode, name, unit, category, sellingPrice, unitCost, quantity, reorderLevel });
    }
  }
  return out;
}

async function vSuppliers(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"suppliers">[]> {
  const live = new Set((await ctx.tx.select({ name: suppliers.name }).from(suppliers)).map((s) => s.name.toUpperCase()));
  const seen = new Map<string, number>();
  const out: StgInsert<"suppliers">[] = [];
  for (const c of rows) {
    const name = c.text("Supplier Name", true, 120);
    if (!duplicate(seen, name?.toUpperCase() ?? null, c, "Supplier Name") && name && live.has(name.toUpperCase())) c.fail("Supplier Name", "Already in the MIS");
    const contact = c.text("Contact", false, 120);
    const tin = c.text("TIN", false, 20);
    const termsDays = c.int("Terms (days)", false, 0, 365) ?? 0;
    const balance = c.money("Balance", true);
    if (c.ok && name && balance !== null) out.push({ rowNo: c.rowNo, name, contact, tin, termsDays, balance });
  }
  return out;
}

async function vStoreAr(ctx: Ctx, rows: Cells[]): Promise<StgInsert<"store_ar">[]> {
  const refs = await memberRefs(ctx);
  const seen = new Map<string, number>();
  const out: StgInsert<"store_ar">[] = [];
  for (const c of rows) {
    const memberNo = memberOf(c, refs);
    duplicate(seen, memberNo, c, "Member No.");
    const balance = c.money("Balance", true);
    if (balance === 0n) c.fail("Balance", "Must be more than 0");
    const chargeLimit = c.money("Charge Limit");
    if (c.ok && memberNo && balance !== null) out.push({ rowNo: c.rowNo, memberNo, balance, chargeLimit });
  }
  return out;
}

async function vTrialBalance(ctx: Ctx, rows: Cells[], errors: RowError[]): Promise<StgInsert<"trial_balance">[]> {
  const byCode = new Map((await ctx.tx.select().from(accounts)).map((a) => [a.code.toUpperCase(), a]));
  const seen = new Map<string, number>();
  const out: StgInsert<"trial_balance">[] = [];
  let debits = 0n;
  let credits = 0n;
  for (const c of rows) {
    const code = c.id("Account Code", true);
    const account = code ? byCode.get(code) : undefined;
    if (!duplicate(seen, code, c, "Account Code") && code) {
      if (!account) c.fail("Account Code", "No such account in the chart of accounts");
      else if (!account.isPostable) c.fail("Account Code", `${account.code} ${account.name} is a header account; use its detail accounts`);
      else if (!account.isActive) c.fail("Account Code", `${account.code} ${account.name} is inactive`);
    }
    c.text("Account Name", false, 200);
    const debit = c.money("Debit") ?? 0n;
    const credit = c.money("Credit") ?? 0n;
    if (debit > 0n && credit > 0n) c.fail("Credit", "Enter either a debit or a credit, not both");
    else if (debit === 0n && credit === 0n) c.fail("Debit", "Enter the debit or the credit balance");
    debits += debit;
    credits += credit;
    if (c.ok && code && account) out.push({ rowNo: c.rowNo, accountCode: account.code, accountId: account.id, debit, credit });
  }
  if (rows.length && debits !== credits) {
    errors.push({ row: rows[rows.length - 1]!.rowNo + 1, column: "Debit", message: `Total debits ${format(debits)} don't equal total credits ${format(credits)}` });
  }
  return out;
}

/** The dry run of a file's rows for the cut-off: the rows ready to stage and every problem found. */
export async function validateRows(tx: Tx, entity: MigrationEntity, raw: RawRow[], cutoff: BusinessDate): Promise<{ result: Validated; errors: RowError[] }> {
  const errors: RowError[] = [];
  const ctx: Ctx = { tx, cutoff };
  const rows = raw.map((r) => new Cells(r, errors));
  let result: Validated;
  switch (entity) {
    case "members":
      result = { entity, rows: await vMembers(ctx, rows) };
      break;
    case "share_capital":
      result = { entity, rows: await vShareCapital(ctx, rows) };
      break;
    case "savings":
      result = { entity, rows: await vSavings(ctx, rows) };
      break;
    case "time_deposits":
      result = { entity, rows: await vTimeDeposits(ctx, rows) };
      break;
    case "loans":
      result = { entity, rows: await vLoans(ctx, rows) };
      break;
    case "water_accounts":
      result = { entity, rows: await vWaterAccounts(ctx, rows) };
      break;
    case "water_bills":
      result = { entity, rows: await vWaterBills(ctx, rows) };
      break;
    case "store_stock":
      result = { entity, rows: await vStoreStock(ctx, rows) };
      break;
    case "suppliers":
      result = { entity, rows: await vSuppliers(ctx, rows) };
      break;
    case "store_ar":
      result = { entity, rows: await vStoreAr(ctx, rows) };
      break;
    case "trial_balance":
      result = { entity, rows: await vTrialBalance(ctx, rows, errors) };
      break;
  }
  if (raw.length === 0) errors.push({ row: 2, column: "(file)", message: "The file has no rows" });
  return { result, errors };
}

/** The cut-off rules: a month end, already over. */
export function cutoffProblem(cutoff: string): string | null {
  if (!isBusinessDate(cutoff)) return "Enter the cut-off date (YYYY-MM-DD)";
  const [y, m] = cutoff.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  if (Number(cutoff.slice(8)) !== last) return "The cut-off must be the last day of a month (a period end)";
  if (cutoff >= businessToday()) return "The cut-off must be a day that is over (go-live is the day after)";
  return null;
}

