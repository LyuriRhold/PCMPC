"use server";

import "@/modules/plugins";
import Decimal from "decimal.js";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { can, requirePermission } from "@/lib/auth-guard";
import { parse as parseMoney } from "@/lib/money";
import { borrowerByNo, cancelApplication, decideApplication, LoanError, submitApplication, updateLoanProduct } from "./service";
import { DEDUCTION_BASES, DEDUCTION_CODES } from "./schema";

const EXPECTED = [LoanError];

function pesos(text: string): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new LoanError("Enter an amount in pesos, e.g. 10,000.00");
  }
}

/** "1.5" (percent) → "0.015". */
function percent(text: string, what: string): string {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new LoanError(`Enter the ${what} as a percentage, e.g. 1.5 for 1.5%`);
  return new Decimal(t).div(100).toFixed();
}

const id = z.uuid();

const submitSchema = z.object({
  memberId: id,
  productId: id,
  amount: z.string().trim().max(20),
  term: z.number().int(),
  purpose: z.string().trim().max(300),
  comakerIds: z.array(id).max(5),
});
/** Loan officer: submits an application (every eligibility rule must pass). */
export async function submitApplicationAction(input: z.input<typeof submitSchema>): Promise<ActionResult<{ id: string; appNo: string }>> {
  const actor = await requirePermission("loans.apply");
  try {
    const data = submitSchema.parse(input);
    return ok(await withTx((tx) => submitApplication(tx, { ...data, amount: pesos(data.amount) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const decideSchema = z.object({ applicationId: id, decision: z.enum(["APPROVE", "REJECT"]), remarks: z.string().trim().max(500) });
/** Manager (first) or Credit Committee (above the manager's limit): approve or reject. */
export async function decideApplicationAction(input: z.input<typeof decideSchema>): Promise<ActionResult<{ status: string }>> {
  const actor = await requirePermission("loans.approve");
  try {
    const data = decideSchema.parse(input);
    return ok(await withTx((tx) => decideApplication(tx, data, { id: actor.id, canRecommend: can(actor, "loans.recommend") })));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelSchema = z.object({ applicationId: id, reason: z.string().trim().max(300) });
/** The encoding loan officer withdraws an undecided application. */
export async function cancelApplicationAction(input: z.input<typeof cancelSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("loans.apply");
  try {
    const data = cancelSchema.parse(input);
    await withTx((tx) => cancelApplication(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const lookupSchema = z.object({ memberNo: z.string().trim().min(1, "Enter the member no.").max(20) });
/** Finds a borrower or comaker by member no. */
export async function borrowerLookupAction(input: z.input<typeof lookupSchema>): Promise<ActionResult<{ id: string; memberNo: string | null; name: string; status: string; goodStanding: boolean; paidUp: string }>> {
  await requirePermission("loans.read");
  try {
    const { memberNo } = lookupSchema.parse(input);
    const m = await borrowerByNo(memberNo);
    if (!m) throw new LoanError(`No member ${memberNo.toUpperCase()}`);
    return ok({ ...m, paidUp: String(m.paidUp) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const productSchema = z.object({
  productId: id,
  name: z.string().trim().max(100),
  ratePct: z.string().max(20),
  minTerm: z.number().int(),
  maxTerm: z.number().int(),
  minAmount: z.string().trim().max(20),
  maxAmount: z.string().trim().max(20),
  maxMultipleOfPaidUp: z.string().trim().max(10),
  requiredComakers: z.number().int(),
  penaltyPct: z.string().max(20),
  graceDays: z.number().int(),
  isActive: z.boolean(),
  deductions: z
    .array(z.object({ code: z.enum(DEDUCTION_CODES), name: z.string().trim().max(60), basis: z.enum(DEDUCTION_BASES), value: z.string().trim().max(20), glKey: z.string().max(60) }))
    .max(10),
});
/** Admin: a loan product's terms and deductions. Percentages and pesos as typed on the form. */
export async function updateLoanProductAction(input: z.input<typeof productSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("admin.settings");
  try {
    const data = productSchema.parse(input);
    await withTx((tx) =>
      updateLoanProduct(
        tx,
        {
          productId: data.productId,
          name: data.name,
          ratePm: percent(data.ratePct, "monthly interest rate"),
          minTerm: data.minTerm,
          maxTerm: data.maxTerm,
          minAmount: data.minAmount ? pesos(data.minAmount) : 0n,
          maxAmount: data.maxAmount ? pesos(data.maxAmount) : null,
          maxMultipleOfPaidUp: data.maxMultipleOfPaidUp || null,
          requiredComakers: data.requiredComakers,
          penaltyRatePm: percent(data.penaltyPct, "monthly penalty rate"),
          graceDays: data.graceDays,
          isActive: data.isActive,
          deductions: data.deductions.map((d) => ({ ...d, value: d.basis === "PCT_OF_PRINCIPAL" ? percent(d.value, d.name || "deduction") : String(pesos(d.value)) })),
        },
        actor.id,
      ),
    );
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
