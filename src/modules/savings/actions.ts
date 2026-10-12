"use server";

import "@/modules/plugins";
import Decimal from "decimal.js";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { JobAlreadyRunError } from "@/lib/jobs";
import { parse as parseMoney } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import {
  closeAccount,
  matureTimeDeposit,
  openAccount,
  placeTimeDeposit,
  preterminateTimeDeposit,
  reactivate,
  rolloverTimeDeposit,
  runInterest,
  SavingsError,
  updateProduct,
  withdraw,
} from "./service";

const EXPECTED = [SavingsError, LedgerError, CashieringError, JobAlreadyRunError];

function pesos(text: string): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new SavingsError("Enter an amount in pesos, e.g. 1,000.00");
  }
}

/** "2" (percent) → "0.02". */
function percent(text: string, what: string): string {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new SavingsError(`Enter the ${what} as a percentage, e.g. 2 for 2%`);
  return new Decimal(t).div(100).toFixed();
}

const id = z.uuid();
const amountText = z.string().trim().max(20);

const openSchema = z.object({ memberId: id, productId: id });
/** Opens a savings account for an ACTIVE member (teller or membership staff). */
export async function openAccountAction(input: z.input<typeof openSchema>): Promise<ActionResult<{ id: string; accountNo: string }>> {
  const actor = await requirePermission("savings.post");
  try {
    const data = openSchema.parse(input);
    return ok(await withTx((tx) => openAccount(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const withdrawSchema = z.object({ accountId: id, amount: amountText });
/** Teller: pays a savings withdrawal out of the open session's drawer (savings.post and cash.session). */
export async function withdrawAction(input: z.input<typeof withdrawSchema>): Promise<ActionResult<{ jeId: string; balance: string }>> {
  await requirePermission("savings.post");
  const actor = await requirePermission("cash.session");
  try {
    const data = withdrawSchema.parse(input);
    const r = await withTx((tx) => withdraw(tx, { accountId: data.accountId, amount: pesos(data.amount) }, actor.id));
    return ok({ jeId: r.jeId, balance: String(r.balance) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const closeSchema = z.object({ accountId: id });
/** Teller: closes a savings account and pays out its whole balance (savings.post and cash.session). */
export async function closeAccountAction(input: z.input<typeof closeSchema>): Promise<ActionResult<{ paidOut: string }>> {
  await requirePermission("savings.post");
  const actor = await requirePermission("cash.session");
  try {
    const data = closeSchema.parse(input);
    const r = await withTx((tx) => closeAccount(tx, data, actor.id));
    return ok({ paidOut: String(r.paidOut) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const reactivateSchema = z.object({ accountId: id, reason: z.string().trim().max(300) });
/** Manager: reactivates a dormant account. */
export async function reactivateAction(input: z.input<typeof reactivateSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("members.approve");
  try {
    const data = reactivateSchema.parse(input);
    await withTx((tx) => reactivate(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const interestSchema = z.object({ productId: id, periodEnd: z.string().refine(isBusinessDate, "Choose the quarter end") });
/** Bookkeeper: posts a quarter's savings interest (once per product and quarter). */
export async function runInterestAction(input: z.input<typeof interestSchema>): Promise<ActionResult<{ jeId: string | null; accounts: number; total: string; wtax: string }>> {
  const actor = await requirePermission("savings.run_interest");
  try {
    const data = interestSchema.parse(input);
    return ok(await withTx((tx) => runInterest(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const placeSchema = z.object({ memberId: id, productId: id, fromAccountId: id, principal: amountText, termDays: z.number().int() });
/** Places a time deposit funded from the member's savings account. */
export async function placeTimeDepositAction(input: z.input<typeof placeSchema>): Promise<ActionResult<{ timeDepositId: string; accountId: string; certificateNo: string }>> {
  const actor = await requirePermission("savings.post");
  try {
    const data = placeSchema.parse(input);
    return ok(await withTx((tx) => placeTimeDeposit(tx, { ...data, principal: pesos(data.principal) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const tdSchema = z.object({ timeDepositId: id });
/** At maturity: principal and interest go to the member's savings account. */
export async function matureTimeDepositAction(input: z.input<typeof tdSchema>): Promise<ActionResult<{ interest: string }>> {
  const actor = await requirePermission("savings.post");
  try {
    const data = tdSchema.parse(input);
    const r = await withTx((tx) => matureTimeDeposit(tx, data, actor.id));
    return ok({ interest: String(r.interest) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Before maturity: interest at the regular savings rate for the days held. */
export async function preterminateTimeDepositAction(input: z.input<typeof tdSchema>): Promise<ActionResult<{ interest: string }>> {
  const actor = await requirePermission("savings.post");
  try {
    const data = tdSchema.parse(input);
    const r = await withTx((tx) => preterminateTimeDeposit(tx, data, actor.id));
    return ok({ interest: String(r.interest) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const rolloverSchema = z.object({ timeDepositId: id, withInterest: z.boolean(), termDays: z.number().int() });
/** At maturity: a new certificate for the principal (and the interest, if chosen). */
export async function rolloverTimeDepositAction(input: z.input<typeof rolloverSchema>): Promise<ActionResult<{ certificateNo: string; interest: string; principal: string }>> {
  const actor = await requirePermission("savings.post");
  try {
    const data = rolloverSchema.parse(input);
    const r = await withTx((tx) => rolloverTimeDeposit(tx, data, actor.id));
    return ok({ certificateNo: r.certificateNo, interest: String(r.interest), principal: String(r.principal) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const productSchema = z.object({
  productId: id,
  name: z.string().trim().max(100),
  ratePct: z.string().max(20),
  minBalanceEarn: amountText,
  maintainingBalance: amountText,
  dormantAfterMonths: z.number().int().nullable(),
  wtaxPct: z.string().max(20),
  active: z.boolean(),
});
/** Admin: changes a deposit product's rates and limits. */
export async function updateProductAction(input: z.input<typeof productSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("admin.settings");
  try {
    const data = productSchema.parse(input);
    await withTx((tx) =>
      updateProduct(
        tx,
        {
          productId: data.productId,
          name: data.name,
          ratePa: percent(data.ratePct, "interest rate"),
          minBalanceEarn: pesos(data.minBalanceEarn),
          maintainingBalance: pesos(data.maintainingBalance),
          dormantAfterMonths: data.dormantAfterMonths,
          wtaxRate: percent(data.wtaxPct, "withholding tax"),
          active: data.active,
        },
        actor.id,
      ),
    );
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
