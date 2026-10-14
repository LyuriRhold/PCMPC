import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { format } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { registerReceiptItem, type ReceiptContext } from "@/modules/cashiering/registry";
import { accountIdFor } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { memberAr } from "./pos";

/**
 * Store charges paid at the teller (PHASE-13 T13.5): receipt item STORE_AR_PAYMENT, Cr AR–Members
 * tagged with the member, up to what the member owes the store. The GL lines are the member's
 * charge account, so cancelling the receipt (its exact reversal) restores the balance.
 */

/** Members already paid for on a receipt (one store payment per member per receipt). */
const seen = new WeakMap<ReceiptContext, Set<string>>();

async function owedBy(tx: Tx, memberId: string) {
  // Locks the member: a payment and a charge sale for the same member are recorded one at a time.
  const [m] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (!m) throw new CashieringError("Member not found");
  return { member: m, owed: await memberAr(memberId, tx) };
}

registerReceiptItem({
  type: "STORE_AR_PAYMENT",
  label: "Store charges payment",
  permission: "cash.receipt",
  dues: async (db, payor) => {
    if (payor.type !== "MEMBER" || !payor.id) return [];
    const owed = await memberAr(payor.id, db);
    if (owed <= 0n) return [];
    return [{ type: "STORE_AR_PAYMENT", refId: payor.id, description: `Store charges (owed ${format(owed)})`, amount: owed, payable: true }];
  },
  validate: async (tx, input, ctx) => {
    if (ctx.payor.type !== "MEMBER" || !ctx.payor.id) throw new CashieringError("Store charges are paid on a member's receipt");
    if (input.refId !== ctx.payor.id) throw new CashieringError("That is another member's store account");
    const done = seen.get(ctx) ?? new Set<string>();
    if (done.has(ctx.payor.id)) throw new CashieringError("Put one store charges payment per member on a receipt");
    done.add(ctx.payor.id);
    seen.set(ctx, done);
    if (input.amount <= 0n) throw new CashieringError("The amount must be more than zero");
    const { owed } = await owedBy(tx, ctx.payor.id);
    if (input.amount > owed) throw new CashieringError(`The member owes the store ${format(owed > 0n ? owed : 0n)}`);
  },
  apply: async (tx, input, ctx) => ({
    creditLines: [{ accountId: await accountIdFor("accounts_receivable_members", tx), credit: input.amount, memberId: ctx.payor.id, memo: ctx.receiptNo }],
    description: "Store charges payment",
    refId: ctx.payor.id,
  }),
  // The receipt's reversal entry puts the charge back on the member's account; nothing else to undo.
  reverse: async () => {},
});
