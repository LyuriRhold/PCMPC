"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { parse as parseMoney } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { SavingsError } from "@/modules/savings/service";
import { ShareError } from "@/modules/share/service";
import { LoanError } from "./service";
import { authorizeRelease, cancelRelease, payFromSavings, payOutProceeds, reauthorizeRelease, restructure, writeOff } from "./servicing";

const EXPECTED = [LoanError, LedgerError, CashieringError, SavingsError, ShareError];

function pesos(text: string): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new LoanError("Enter an amount in pesos, e.g. 1,000.00");
  }
}

const id = z.uuid();
const date = z.string().refine(isBusinessDate, "Choose a date");

const authorizeSchema = z.object({ applicationId: id, firstDueDate: date, disbursement: z.enum(["CASH", "SAVINGS"]), savingsAccountId: id.nullable() });
/** Manager (not the approver): authorizes the release of an approved application. */
export async function authorizeReleaseAction(input: z.input<typeof authorizeSchema>): Promise<ActionResult<{ loanId: string; loanNo: string }>> {
  const actor = await requirePermission("loans.release");
  try {
    const data = authorizeSchema.parse(input);
    return ok(await withTx((tx) => authorizeRelease(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const reauthorizeSchema = z.object({ loanId: id, firstDueDate: date });
/** Manager (not the approver): authorizes a loan waiting for its payout again, with a new first due date. */
export async function reauthorizeReleaseAction(input: z.input<typeof reauthorizeSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("loans.release");
  try {
    const data = reauthorizeSchema.parse(input);
    await withTx((tx) => reauthorizeRelease(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelSchema = z.object({ loanId: id, reason: z.string().trim().max(300) });
/** Manager: cancels a loan not yet paid out (and its application). */
export async function cancelReleaseAction(input: z.input<typeof cancelSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("loans.release");
  try {
    const data = cancelSchema.parse(input);
    await withTx((tx) => cancelRelease(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const loanSchema = z.object({ loanId: id });
/** Teller: pays the net proceeds of an authorized loan out of the drawer (the release entry). */
export async function payOutProceedsAction(input: z.input<typeof loanSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("cash.session");
  try {
    const data = loanSchema.parse(input);
    return ok(await withTx((tx) => payOutProceeds(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const writeOffSchema = z.object({ loanId: id, bodRef: z.string().trim().max(100), reason: z.string().trim().max(300) });
/** Manager: writes off a loan's outstanding principal on the Board's resolution. */
export async function writeOffAction(input: z.input<typeof writeOffSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("loans.writeoff");
  try {
    const data = writeOffSchema.parse(input);
    const r = await withTx((tx) => writeOff(tx, data, actor.id));
    return ok({ jeId: r.jeId });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const restructureSchema = z.object({ loanId: id, term: z.number().int(), firstDueDate: date, bodRef: z.string().trim().max(100), reason: z.string().trim().max(300) });
/** Manager: closes a loan into a new one with a new term, on the Board's resolution. */
export async function restructureAction(input: z.input<typeof restructureSchema>): Promise<ActionResult<{ loanId: string; loanNo: string }>> {
  const actor = await requirePermission("loans.release");
  try {
    const data = restructureSchema.parse(input);
    const r = await withTx((tx) => restructure(tx, data, actor.id));
    return ok({ loanId: r.loanId, loanNo: r.loanNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const fromSavingsSchema = z.object({ loanId: id, accountId: id, amount: z.string().trim().max(20) });
/** Teller: pays a loan from the member's savings (no cash). */
export async function payFromSavingsAction(input: z.input<typeof fromSavingsSchema>): Promise<ActionResult<{ jeId: string }>> {
  await requirePermission("savings.post");
  const actor = await requirePermission("loans.collect");
  try {
    const data = fromSavingsSchema.parse(input);
    return ok(await withTx((tx) => payFromSavings(tx, { ...data, amount: pesos(data.amount) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
