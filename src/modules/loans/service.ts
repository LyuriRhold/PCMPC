import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { addMonths, businessToday, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { normalizeName } from "@/lib/names";
import { next as nextNumber } from "@/lib/numbering";
import { users } from "@/modules/auth/schema";
import { members } from "@/modules/members/schema";
import { getSetting } from "@/modules/settings/service";
import { isGoodStanding, shareBalance } from "@/modules/share/service";
import { effectiveMonthlyRate, netProceeds, schedule, scheduleTotals, type ScheduleRow } from "./amortization";
import { checkEligibility } from "./eligibility";
import {
  loanApplicationComakers,
  loanApplications,
  loanApprovals,
  loanProductDeductions,
  loanProducts,
  type ApprovalDecision,
  type ApprovalLevel,
  type DeductionBasis,
  type DeductionCode,
  type LoanApplicationStatus,
  type LoanMethod,
  type LoanProduct,
  type LoanProductDeduction,
} from "./schema";

/**
 * Loan products and applications (PHASE-10 T10.5). Workflow: SUBMITTED (loan officer) → the
 * manager reviews: up to loan.manager_approval_limit that approves it (APPROVED), above it the
 * application is RECOMMENDED to the Credit Committee, whose approval makes it APPROVED. Nobody
 * decides on an application they encoded; a rejection needs remarks.
 */

/** A loan rule was broken; the message is safe to show. */
export class LoanError extends Error {
  override name = "LoanError";
}

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;

// ── Products ──

export async function loanProductByCode(code: string, db: Db | Tx = getDb()): Promise<LoanProduct | undefined> {
  const [p] = await db.select().from(loanProducts).where(eq(loanProducts.code, code));
  return p;
}

export type ProductWithDeductions = LoanProduct & { deductions: LoanProductDeduction[] };

export async function listLoanProducts(db: Db | Tx = getDb(), onlyActive = false): Promise<ProductWithDeductions[]> {
  const products = await db.select().from(loanProducts).where(onlyActive ? eq(loanProducts.isActive, true) : undefined).orderBy(asc(loanProducts.code));
  if (products.length === 0) return [];
  const deductions = await db.select().from(loanProductDeductions).where(inArray(loanProductDeductions.productId, products.map((p) => p.id))).orderBy(asc(loanProductDeductions.sort));
  return products.map((p) => ({ ...p, deductions: deductions.filter((d) => d.productId === p.id) }));
}

export async function getLoanProduct(productId: string, db: Db | Tx = getDb()): Promise<ProductWithDeductions | undefined> {
  return (await listLoanProducts(db)).find((p) => p.id === productId);
}

export type ProductChanges = {
  name: string;
  ratePm: string;
  minTerm: number;
  maxTerm: number;
  maxAmount: Money | null;
  maxMultipleOfPaidUp: string | null;
  requiredComakers: number;
  penaltyRatePm: string;
  graceDays: number;
  isActive: boolean;
  deductions: Array<{ code: DeductionCode; name: string; basis: DeductionBasis; value: string; glKey: string }>;
};

const DEDUCTION_GL: Record<DeductionCode, string[]> = {
  SERVICE_FEE: ["service_fee_income"],
  CBU: ["subscription_receivable_common"],
  LPP: ["lpp_insurance_payable"],
  NOTARIAL: ["notarial_fee_income"],
  OTHER: ["service_fee_income", "notarial_fee_income", "lpp_insurance_payable"],
};

/** Admin: a product's terms and its deductions (applications keep the terms they were submitted on). */
export async function updateLoanProduct(tx: Tx, input: { productId: string } & ProductChanges, actorId: string) {
  const [before] = await tx.select().from(loanProducts).where(eq(loanProducts.id, input.productId)).for("update");
  if (!before) throw new LoanError("Loan product not found");
  const decimal = /^\d+(\.\d+)?$/;
  if (!input.name.trim()) throw new LoanError("Enter the product name");
  if (!decimal.test(input.ratePm) || Number(input.ratePm) > 1) throw new LoanError("Enter the monthly interest rate as a percentage");
  if (!decimal.test(input.penaltyRatePm) || Number(input.penaltyRatePm) > 1) throw new LoanError("Enter the monthly penalty rate as a percentage");
  if (!Number.isInteger(input.minTerm) || !Number.isInteger(input.maxTerm) || input.minTerm < 1 || input.maxTerm < input.minTerm || input.maxTerm > 360) throw new LoanError("Enter the shortest and longest terms in months (1 to 360)");
  if (input.maxAmount !== null && input.maxAmount <= 0n) throw new LoanError("The maximum amount must be more than zero");
  if (input.maxMultipleOfPaidUp !== null && (!decimal.test(input.maxMultipleOfPaidUp) || Number(input.maxMultipleOfPaidUp) <= 0)) throw new LoanError("Enter the multiple of paid-up share capital, e.g. 3");
  if (!Number.isInteger(input.requiredComakers) || input.requiredComakers < 0 || input.requiredComakers > 5) throw new LoanError("Enter the number of comakers (0 to 5)");
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 60) throw new LoanError("Enter the grace days (0 to 60)");
  for (const d of input.deductions) {
    if (!d.name.trim()) throw new LoanError("Each deduction needs a name");
    if (d.basis === "PCT_OF_PRINCIPAL" ? !decimal.test(d.value) || Number(d.value) >= 1 : !/^\d+$/.test(d.value)) throw new LoanError(`Enter the ${d.name} as a percentage below 100% or an amount`);
    if (!DEDUCTION_GL[d.code].includes(d.glKey)) throw new LoanError(`${d.name} can't be credited to ${d.glKey}`);
  }
  const { deductions, ...fields } = input;
  const changes = { name: fields.name.trim(), ratePm: fields.ratePm, minTerm: fields.minTerm, maxTerm: fields.maxTerm, maxAmount: fields.maxAmount, maxMultipleOfPaidUp: fields.maxMultipleOfPaidUp, requiredComakers: fields.requiredComakers, penaltyRatePm: fields.penaltyRatePm, graceDays: fields.graceDays, isActive: fields.isActive };
  await tx.update(loanProducts).set(changes).where(eq(loanProducts.id, before.id));
  const old = await tx.select().from(loanProductDeductions).where(eq(loanProductDeductions.productId, before.id));
  await tx.delete(loanProductDeductions).where(eq(loanProductDeductions.productId, before.id));
  if (deductions.length) await tx.insert(loanProductDeductions).values(deductions.map((d, i) => ({ ...d, name: d.name.trim(), productId: before.id, sort: i, createdBy: actorId })));
  await audit(tx, {
    action: "loans.product_update",
    entity: "loan_product",
    entityId: before.id,
    before: { ...before, maxAmount: before.maxAmount === null ? null : format(before.maxAmount), deductions: old.map((d) => ({ code: d.code, basis: d.basis, value: d.value })) },
    after: { ...changes, maxAmount: changes.maxAmount === null ? null : format(changes.maxAmount), deductions: deductions.map((d) => ({ code: d.code, basis: d.basis, value: d.value })) },
    userId: actorId,
  });
}

// ── Calculator / preview ──

export type LoanPreview = { rows: ScheduleRow[]; totalInterest: Money; totalPayment: Money; regularPayment: Money; deductions: Array<{ code: string; name: string; amount: Money; glKey: string }>; totalDeductions: Money; net: Money; effectiveRatePm: string };

/** A product's schedule, deductions and net proceeds for an amount and term (calculator and preview). */
export function previewLoan(product: ProductWithDeductions, input: { amount: Money; term: number; firstDueDate: BusinessDate; method?: LoanMethod; ratePm?: string }): LoanPreview {
  const rows = schedule({ principal: input.amount, ratePm: input.ratePm ?? product.ratePm, term: input.term, method: input.method ?? product.method, firstDueDate: input.firstDueDate });
  const totals = scheduleTotals(rows);
  const np = netProceeds(input.amount, product.deductions.map((d) => ({ code: d.code, name: d.name, basis: d.basis, value: d.value, glKey: d.glKey })));
  return {
    rows,
    totalInterest: totals.interest,
    totalPayment: totals.payment,
    regularPayment: totals.regularPayment,
    deductions: np.lines,
    totalDeductions: np.total,
    net: np.net,
    effectiveRatePm: effectiveMonthlyRate(np.net, rows.map((r) => r.payment)),
  };
}

/** The tentative first due date shown before release: one month after today. */
export function tentativeFirstDueDate(): BusinessDate {
  return addMonths(businessToday(), 1);
}

// ── Applications (T10.5) ──

async function lockMember(tx: Tx, memberId: string): Promise<MemberRow> {
  const [m] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (!m) throw new LoanError("Member not found");
  return m;
}

/** The loan officer submits an application; every eligibility rule must pass (the results are kept). */
export async function submitApplication(tx: Tx, input: { memberId: string; productId: string; amount: Money; term: number; purpose: string; comakerIds: string[] }, officerId: string) {
  const member = await lockMember(tx, input.memberId);
  const product = await getLoanProduct(input.productId, tx);
  if (!product || !product.isActive) throw new LoanError("Choose an active loan product");
  if (input.amount <= 0n) throw new LoanError("The loan amount must be more than zero");
  if (!Number.isInteger(input.term) || input.term < 1) throw new LoanError("Enter the term in months");
  const purpose = input.purpose.trim();
  if (!purpose) throw new LoanError("Enter the purpose of the loan");
  const comakers = input.comakerIds.length ? await tx.select().from(members).where(inArray(members.id, input.comakerIds)) : [];
  if (comakers.length !== new Set(input.comakerIds).size) throw new LoanError("A comaker was not found");
  // Keep the order the officer entered (and duplicates, so the rule can name them).
  const ordered = input.comakerIds.map((id) => comakers.find((c) => c.id === id)).filter((c): c is MemberRow => !!c);

  const eligibility = await checkEligibility(tx, { member, product, amount: input.amount, term: input.term, comakers: ordered });
  const failed = eligibility.filter((r) => !r.pass);
  if (failed.length) throw new LoanError(failed.map((r) => r.message).join("; "));

  const firstDueDate = tentativeFirstDueDate();
  const preview = previewLoan(product, { amount: input.amount, term: input.term, firstDueDate });
  const appNo = await nextNumber("LA", tx);
  const [app] = await tx
    .insert(loanApplications)
    .values({
      appNo,
      memberId: member.id,
      productId: product.id,
      amount: input.amount,
      term: input.term,
      purpose,
      method: product.method,
      ratePm: product.ratePm,
      firstDueDate,
      eligibility,
      schedulePreview: preview.rows.map((r) => ({ no: r.no, dueDate: r.dueDate, principal: String(r.principal), interest: String(r.interest), payment: String(r.payment), balance: String(r.balance) })),
      deductions: preview.deductions.map((d) => ({ code: d.code, name: d.name, amount: String(d.amount), glKey: d.glKey })),
      netProceeds: preview.net,
      totalInterest: preview.totalInterest,
      encodedBy: officerId,
      createdBy: officerId,
    })
    .returning({ id: loanApplications.id });
  if (!app) throw new Error("application insert returned no row");
  if (ordered.length) await tx.insert(loanApplicationComakers).values(ordered.map((c) => ({ applicationId: app.id, memberId: c.id, createdBy: officerId })));
  await audit(tx, { action: "loans.apply", entity: "loan_application", entityId: app.id, after: { appNo, member: member.memberNo, product: product.code, amount: format(input.amount), term: input.term, comakers: ordered.map((c) => c.memberNo) }, userId: officerId });
  return { id: app.id, appNo };
}

/**
 * A decision on an application. `canRecommend` (the manager) decides first, on SUBMITTED ones;
 * otherwise the decider is the Credit Committee, on RECOMMENDED ones. Approving re-checks
 * eligibility (the member's situation may have changed since submission).
 */
export async function decideApplication(tx: Tx, input: { applicationId: string; decision: ApprovalDecision; remarks: string }, actor: { id: string; canRecommend: boolean }) {
  const [app] = await tx.select().from(loanApplications).where(eq(loanApplications.id, input.applicationId)).for("update");
  if (!app) throw new LoanError("Loan application not found");
  assertNotSameUser(app.encodedBy, actor.id);
  const level: ApprovalLevel = actor.canRecommend ? "MANAGER" : "CREDIT_COMMITTEE";
  if (level === "MANAGER" && app.status !== "SUBMITTED") throw new LoanError(app.status === "RECOMMENDED" ? "The manager already recommended it; the Credit Committee decides now" : `The application is already ${app.status}`);
  if (level === "CREDIT_COMMITTEE" && app.status !== "RECOMMENDED") throw new LoanError(app.status === "SUBMITTED" ? "The manager reviews it first" : `The application is already ${app.status}`);
  const earlier = await tx.select({ by: loanApprovals.by }).from(loanApprovals).where(eq(loanApprovals.applicationId, app.id));
  if (earlier.some((a) => a.by === actor.id)) throw new LoanError("You already decided on this application at another level");
  const remarks = input.remarks.trim();
  if (input.decision === "REJECT" && !remarks) throw new LoanError("Enter the reason for rejecting");

  let status: LoanApplicationStatus;
  if (input.decision === "REJECT") status = "REJECTED";
  else {
    const member = await lockMember(tx, app.memberId);
    const product = await getLoanProduct(app.productId, tx);
    if (!product) throw new LoanError("Loan product not found");
    const comakerRows = await tx.select({ m: members }).from(loanApplicationComakers).innerJoin(members, eq(members.id, loanApplicationComakers.memberId)).where(eq(loanApplicationComakers.applicationId, app.id));
    const results = await checkEligibility(tx, { member, product: { ...product, ratePm: app.ratePm, method: app.method }, amount: app.amount, term: app.term, comakers: comakerRows.map((r) => r.m) });
    const failed = results.filter((r) => !r.pass);
    if (failed.length) throw new LoanError(`Not eligible any more: ${failed.map((r) => r.message).join("; ")}`);
    const limit = BigInt(await getSetting("loan.manager_approval_limit", tx));
    status = level === "MANAGER" && app.amount > limit ? "RECOMMENDED" : "APPROVED";
  }
  await tx.insert(loanApprovals).values({ applicationId: app.id, level, decision: input.decision, remarks: remarks || null, by: actor.id, createdBy: actor.id });
  await tx.update(loanApplications).set({ status }).where(eq(loanApplications.id, app.id));
  await audit(tx, { action: `loans.${input.decision === "APPROVE" ? "approve" : "reject"}`, entity: "loan_application", entityId: app.id, before: { status: app.status }, after: { status, level, remarks }, userId: actor.id });
  return { status };
}

/** The encoder withdraws an application that wasn't decided yet. */
export async function cancelApplication(tx: Tx, input: { applicationId: string; reason: string }, actorId: string) {
  const [app] = await tx.select().from(loanApplications).where(eq(loanApplications.id, input.applicationId)).for("update");
  if (!app) throw new LoanError("Loan application not found");
  if (app.encodedBy !== actorId) throw new LoanError("Only the loan officer who encoded it can cancel it");
  if (app.status !== "SUBMITTED" && app.status !== "RECOMMENDED") throw new LoanError(`The application is already ${app.status}`);
  const reason = input.reason.trim();
  if (!reason) throw new LoanError("Enter why it is cancelled");
  await tx.update(loanApplications).set({ status: "CANCELLED" }).where(eq(loanApplications.id, app.id));
  await audit(tx, { action: "loans.cancel", entity: "loan_application", entityId: app.id, before: { status: app.status }, after: { status: "CANCELLED", reason }, userId: actorId });
}

/** An application with its product, borrower, comakers and decisions. */
export async function getApplication(applicationId: string, db: Db | Tx = getDb()) {
  const [row] = await db
    .select({ application: loanApplications, product: loanProducts, member: members, encodedBy: users.username })
    .from(loanApplications)
    .innerJoin(loanProducts, eq(loanProducts.id, loanApplications.productId))
    .innerJoin(members, eq(members.id, loanApplications.memberId))
    .innerJoin(users, eq(users.id, loanApplications.encodedBy))
    .where(eq(loanApplications.id, applicationId));
  if (!row) return null;
  const [comakers, approvals] = [
    await db.select({ m: members }).from(loanApplicationComakers).innerJoin(members, eq(members.id, loanApplicationComakers.memberId)).where(eq(loanApplicationComakers.applicationId, applicationId)).orderBy(asc(loanApplicationComakers.createdAt)),
    await db.select({ a: loanApprovals, by: users.username }).from(loanApprovals).innerJoin(users, eq(users.id, loanApprovals.by)).where(eq(loanApprovals.applicationId, applicationId)).orderBy(asc(loanApprovals.at)),
  ];
  return { ...row, comakers: comakers.map((c) => c.m), approvals: approvals.map((a) => ({ ...a.a, byName: a.by })) };
}

/** Applications, newest first (the approval queue filters by status). */
export async function applicationRegistry(filters: { status?: LoanApplicationStatus; q?: string }, db: Db | Tx = getDb()) {
  const conds = normalizeName(filters.q)
    .split(" ")
    .filter(Boolean)
    .map((t) => sql`(${members.searchText} LIKE ${`%${t}%`} OR lower(${loanApplications.appNo}) LIKE ${`%${t}%`})`);
  if (filters.status) conds.push(eq(loanApplications.status, filters.status));
  return db
    .select({ application: loanApplications, productName: loanProducts.name, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName })
    .from(loanApplications)
    .innerJoin(loanProducts, eq(loanProducts.id, loanApplications.productId))
    .innerJoin(members, eq(members.id, loanApplications.memberId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(loanApplications.createdAt))
    .limit(200);
}

/** A member found by member no., with what the application form needs to know. */
export async function borrowerByNo(memberNo: string, db: Db | Tx = getDb()) {
  const [m] = await db.select().from(members).where(eq(members.memberNo, memberNo.trim().toUpperCase()));
  if (!m) return null;
  return { id: m.id, memberNo: m.memberNo, name: nameOf(m), status: m.status, goodStanding: m.status === "ACTIVE" && (await isGoodStanding(m.id, db)), paidUp: (await shareBalance(m.id, db)).paidUp };
}
