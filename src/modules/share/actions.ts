"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { parse as parseMoney } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { ShareError, subscribe, transfer, withdraw } from "./service";

const EXPECTED = [ShareError, LedgerError, CashieringError];

function pesos(text: string): bigint {
  try {
    return parseMoney(text);
  } catch {
    throw new ShareError("Enter an amount in pesos, e.g. 1,000.00");
  }
}

const subscribeSchema = z.object({ memberId: z.uuid(), shares: z.number().int().min(1, "Enter the number of shares").max(1_000_000) });
/** Subscribes shares for a member (encoded by the membership/records staff). */
export async function subscribeAction(input: z.input<typeof subscribeSchema>): Promise<ActionResult<{ id: string; jeId: string }>> {
  const actor = await requirePermission("members.write");
  try {
    const data = subscribeSchema.parse(input);
    const r = await withTx((tx) => subscribe(tx, data, actor.id));
    return ok({ id: r.id, jeId: r.jeId });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const transferSchema = z.object({ fromMemberId: z.uuid(), toMemberId: z.uuid(), amount: z.string().trim().max(20), bodRef: z.string().trim().max(100) });
/** Transfers paid-up capital between members on a Board resolution (manager). */
export async function transferAction(input: z.input<typeof transferSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("members.approve");
  try {
    const data = transferSchema.parse(input);
    return ok(await withTx((tx) => transfer(tx, { ...data, amount: pesos(data.amount) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const withdrawSchema = z.object({ memberId: z.uuid(), reason: z.string().trim().max(300) });
/** Pays out a terminating member's share capital at the teller (cash-out from the open session). */
export async function withdrawSharesAction(input: z.input<typeof withdrawSchema>): Promise<ActionResult<{ jeId: string; cash: string }>> {
  const actor = await requirePermission("cash.session");
  try {
    const data = withdrawSchema.parse(input);
    const r = await withTx((tx) => withdraw(tx, data, actor.id));
    return ok({ jeId: r.jeId, cash: String(r.cash) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
