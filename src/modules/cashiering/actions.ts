"use server";

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { parse as parseMoney, type Money } from "@/lib/money";
import { members } from "@/modules/members/schema";
import { accountIdFor, LedgerError } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import { duesFor, payorType, receiptItem } from "./registry";
import {
  approveDv,
  bankDeposit,
  cancelDv,
  cancelReceipt,
  CashieringError,
  closeSession,
  createDv,
  issueReceipt,
  openSession,
  releaseDv,
  verifySession,
  type DvLineInput,
} from "./service";

const EXPECTED = [CashieringError, LedgerError];

/** Peso text → centavos; a bad amount becomes a friendly error. */
function pesos(text: string, what = "amount"): Money {
  try {
    return parseMoney(text);
  } catch {
    throw new CashieringError(`Enter a valid ${what} (e.g. 1,250.50)`);
  }
}

const amountText = z.string().trim().min(1, "Enter an amount").max(20);
const businessDate = z.string().refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)");
const payorSchema = z.object({ type: z.string().min(1).max(40), id: z.string().max(80).nullable(), name: z.string().max(200) });

// ── Sessions ──

const openSchema = z.object({ openingCash: amountText });
export async function openSessionAction(input: z.input<typeof openSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("cash.session");
  try {
    const data = openSchema.parse(input);
    const s = await withTx((tx) => openSession(tx, actor.id, pesos(data.openingCash, "opening cash")));
    return ok({ id: s.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const closeSchema = z.object({
  sessionId: z.uuid(),
  counts: z.array(z.object({ denomination: amountText, kind: z.enum(["BILL", "COIN"]).optional(), qty: z.number().int().min(0).max(1_000_000) })).max(30),
});
export async function closeSessionAction(input: z.input<typeof closeSchema>): Promise<ActionResult<{ expected: string; counted: string; variance: string }>> {
  const actor = await requirePermission("cash.session");
  try {
    const data = closeSchema.parse(input);
    const denoms = await getSetting("cash.denominations");
    const counts = data.counts
      .filter((c) => c.qty > 0)
      .map((c) => {
        const value = pesos(c.denomination, "denomination");
        // When the kind isn't given, a bill is meant if that value exists as a bill.
        const kind = c.kind ?? (denoms.some((d) => BigInt(d.value) === value && d.kind === "BILL") ? "BILL" : "COIN");
        return { denomination: value, kind, qty: c.qty };
      });
    const s = await withTx((tx) => closeSession(tx, data.sessionId, counts, actor.id));
    return ok({ expected: String(s.expectedCash), counted: String(s.countedCash), variance: String(s.variance) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const sessionIdSchema = z.object({ sessionId: z.uuid() });
/** Manager verification; throws (not returns) when the manager is the session's teller (SoD). */
export async function verifySessionAction(input: z.input<typeof sessionIdSchema>): Promise<ActionResult<{ varianceJeId: string | null }>> {
  const actor = await requirePermission("cash.verify");
  try {
    const { sessionId } = sessionIdSchema.parse(input);
    const s = await withTx((tx) => verifySession(tx, sessionId, actor.id));
    return ok({ varianceJeId: s.varianceJeId });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Receipts ──

const receiptSchema = z.object({
  payor: payorSchema,
  mode: z.enum(["CASH", "CHECK", "BANK_TRANSFER"]),
  checkNo: z.string().trim().max(40).nullable(),
  birReceiptNo: z.string().trim().max(40).nullable(),
  items: z
    .array(z.object({ type: z.string().min(1).max(40), refId: z.string().max(80).nullable(), amount: amountText, description: z.string().trim().max(200).nullable() }))
    .min(1, "Add at least one item")
    .max(30),
});

/** Issues one receipt for many items. Each item type's own permission is checked too. */
export async function issueReceiptAction(input: z.input<typeof receiptSchema>): Promise<ActionResult<{ id: string; receiptNo: string; total: string }>> {
  const actor = await requirePermission("cash.session");
  let data: z.output<typeof receiptSchema>;
  try {
    data = receiptSchema.parse(input);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
  for (const type of new Set(data.items.map((i) => i.type))) {
    const def = receiptItem(type);
    if (def) await requirePermission(def.permission);
  }
  try {
    const items = data.items.map((i) => ({ type: i.type, refId: i.refId, amount: pesos(i.amount), description: i.description || null }));
    const r = await withTx((tx) => issueReceipt(tx, { payor: data.payor, mode: data.mode, checkNo: data.checkNo, birReceiptNo: data.birReceiptNo, items }, actor.id));
    return ok({ id: r.id, receiptNo: r.receiptNo, total: String(r.total) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelSchema = z.object({ receiptId: z.uuid(), reason: z.string().trim().min(1, "A reason is required").max(300) });
/** Same-day cancellation by a supervisor; throws (not returns) when the supervisor issued it (SoD). */
export async function cancelReceiptAction(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const actor = await requirePermission("cash.cancel");
  try {
    const data = cancelSchema.parse(input);
    await withTx((tx) => cancelReceipt(tx, data.receiptId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const payorSearchSchema = z.object({ type: z.string().min(1).max(40), q: z.string().max(100) });
export async function searchPayorsAction(input: z.input<typeof payorSearchSchema>): Promise<ActionResult<Array<{ id: string; name: string; detail: string }>>> {
  await requirePermission("cash.session");
  try {
    const data = payorSearchSchema.parse(input);
    const pt = payorType(data.type);
    if (!pt?.search) return ok([]);
    return ok(await pt.search(getDb(), data.q));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const duesSchema = z.object({ payor: payorSchema });
export async function duesAction(input: z.input<typeof duesSchema>): Promise<ActionResult<Array<{ type: string; refId: string | null; description: string; amount: string; payable: boolean }>>> {
  await requirePermission("cash.session");
  try {
    const { payor } = duesSchema.parse(input);
    const dues = await duesFor(getDb(), payor);
    return ok(dues.map((d) => ({ ...d, amount: String(d.amount) })));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Disbursement vouchers and bank deposits ──

const dvSchema = z.object({
  date: businessDate,
  payee: z.string().trim().min(1, "Payee is required").max(200),
  particulars: z.string().trim().min(1, "Particulars are required").max(500),
  mode: z.enum(["CASH", "CHECK"]),
  checkNo: z.string().trim().max(40).nullable(),
  lines: z
    .array(
      z.object({
        accountId: z.union([z.uuid(), z.literal("")]),
        /** Alternative to accountId: a DOMAIN §6 posting key. */
        mappingKey: z.string().max(60).optional(),
        amount: amountText,
        memberNo: z.string().trim().max(20),
        memo: z.string().trim().max(200),
      }),
    )
    .min(1, "Add at least one account line")
    .max(30),
});

export async function createDvAction(input: z.input<typeof dvSchema>): Promise<ActionResult<{ id: string; dvNo: string }>> {
  const actor = await requirePermission("cash.dv_prepare");
  try {
    const data = dvSchema.parse(input);
    const nos = [...new Set(data.lines.map((l) => l.memberNo.toUpperCase()).filter(Boolean))];
    const found = nos.length ? await getDb().select({ id: members.id, memberNo: members.memberNo }).from(members).where(inArray(members.memberNo, nos)) : [];
    const lines: DvLineInput[] = [];
    for (const [i, l] of data.lines.entries()) {
      const accountId = l.accountId || (l.mappingKey ? await accountIdFor(l.mappingKey) : "");
      if (!accountId) throw new CashieringError(`Line ${i + 1}: choose an account`);
      const memberNo = l.memberNo.toUpperCase();
      const memberId = memberNo ? found.find((m) => m.memberNo === memberNo)?.id : null;
      if (memberNo && !memberId) throw new CashieringError(`Line ${i + 1}: member ${memberNo} not found`);
      lines.push({ accountId, memberId: memberId ?? null, amount: pesos(l.amount), memo: l.memo || null });
    }
    const dv = await withTx((tx) => createDv(tx, { date: data.date, payee: data.payee, particulars: data.particulars, mode: data.mode, checkNo: data.checkNo, lines }, actor.id));
    return ok({ id: dv.id, dvNo: dv.dvNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const dvIdSchema = z.object({ dvId: z.uuid() });
/** Approves a DV; throws (not returns) when the approver prepared it (SoD). */
export async function approveDvAction(input: z.input<typeof dvIdSchema>): Promise<ActionResult> {
  const actor = await requirePermission("cash.dv_approve");
  try {
    const { dvId } = dvIdSchema.parse(input);
    await withTx((tx) => approveDv(tx, dvId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

export async function releaseDvAction(input: z.input<typeof dvIdSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("cash.session");
  try {
    const { dvId } = dvIdSchema.parse(input);
    const dv = await withTx((tx) => releaseDv(tx, dvId, actor.id));
    return ok({ jeId: dv.jeId ?? "" });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const cancelDvSchema = z.object({ dvId: z.uuid(), reason: z.string().trim().min(1, "A reason is required").max(300) });
export async function cancelDvAction(input: z.input<typeof cancelDvSchema>): Promise<ActionResult> {
  const actor = await requirePermission("cash.dv_approve");
  try {
    const data = cancelDvSchema.parse(input);
    await withTx((tx) => cancelDv(tx, data.dvId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const depositSchema = z.object({ amount: amountText, bankReference: z.string().trim().min(1, "Enter the deposit slip / bank reference").max(80) });
export async function bankDepositAction(input: z.input<typeof depositSchema>): Promise<ActionResult> {
  const actor = await requirePermission("cash.session");
  try {
    const data = depositSchema.parse(input);
    await withTx((tx) => bankDeposit(tx, { amount: pesos(data.amount), bankReference: data.bankReference }, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
