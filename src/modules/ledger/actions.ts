"use server";

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { businessToday, isBusinessDate } from "@/lib/dates";
import { parse as parseMoney } from "@/lib/money";
import { members } from "@/modules/members/schema";
import { CoaError } from "./coa";
import { createAccount, setAccountActive, updateAccount } from "./coa-admin";
import { approveJv, createJvDraft, discardJvDraft, LedgerError, reverseJournal, type LineInput } from "./service";

const businessDate = z.string().refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)");
const amount = z.string().trim().max(20);

const lineSchema = z.object({
  accountId: z.uuid("Choose an account"),
  debit: amount,
  credit: amount,
  memberNo: z.string().trim().max(20),
  memo: z.string().trim().max(200),
});
const draftSchema = z.object({
  date: businessDate,
  particulars: z.string().trim().min(1, "Particulars are required").max(500),
  reference: z.string().trim().max(80).optional(),
  lines: z.array(lineSchema).min(2, "An entry needs at least two lines").max(50),
});
const jeIdSchema = z.object({ jeId: z.uuid() });
const reverseSchema = z.object({ jeId: z.uuid(), date: businessDate.optional(), reason: z.string().trim().min(1, "A reason is required").max(300) });

/** Turns form lines (peso text, member no.) into ledger lines (centavos, member id). */
async function toLines(lines: z.output<typeof lineSchema>[]): Promise<LineInput[]> {
  const nos = [...new Set(lines.map((l) => l.memberNo.toUpperCase()).filter(Boolean))];
  const found = nos.length
    ? await getDb().select({ id: members.id, memberNo: members.memberNo }).from(members).where(inArray(members.memberNo, nos))
    : [];
  const idByNo = new Map(found.map((m) => [m.memberNo, m.id]));
  return lines.map((l, i) => {
    const toCentavos = (v: string) => {
      if (!v) return 0n;
      try {
        return parseMoney(v);
      } catch {
        throw new LedgerError(`Line ${i + 1}: "${v}" is not a valid amount`);
      }
    };
    const memberNo = l.memberNo.toUpperCase();
    if (memberNo && !idByNo.has(memberNo)) throw new LedgerError(`Line ${i + 1}: member ${memberNo} not found`);
    return {
      accountId: l.accountId,
      debit: toCentavos(l.debit),
      credit: toCentavos(l.credit),
      memberId: memberNo ? (idByNo.get(memberNo) ?? null) : null,
      memo: l.memo || null,
    };
  });
}

export async function createJvDraftAction(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.jv_prepare");
  try {
    const data = draftSchema.parse(input);
    const lines = await toLines(data.lines);
    const je = await withTx((tx) =>
      createJvDraft(tx, { date: data.date, particulars: data.particulars, reference: data.reference || null, lines }, actor.id),
    );
    return ok({ id: je.id });
  } catch (e) {
    return failFrom(e, [LedgerError]);
  }
}

/** Approves and posts a draft. Throws (not returns) when the approver prepared it: segregation of duties. */
export async function approveJvAction(input: z.input<typeof jeIdSchema>): Promise<ActionResult<{ jeNo: string }>> {
  const actor = await requirePermission("gl.jv_approve");
  try {
    const { jeId } = jeIdSchema.parse(input);
    const je = await withTx((tx) => approveJv(tx, jeId, actor.id));
    return ok({ jeNo: je.jeNo ?? "" });
  } catch (e) {
    return failFrom(e, [LedgerError]);
  }
}

export async function reverseJvAction(input: z.input<typeof reverseSchema>): Promise<ActionResult<{ jeNo: string }>> {
  const actor = await requirePermission("gl.jv_approve");
  try {
    const data = reverseSchema.parse(input);
    const rev = await withTx((tx) => reverseJournal(tx, data.jeId, data.date ?? businessToday(), data.reason, actor.id));
    return ok({ jeNo: rev.jeNo ?? "" });
  } catch (e) {
    return failFrom(e, [LedgerError]);
  }
}

export async function discardJvAction(input: z.input<typeof jeIdSchema>): Promise<ActionResult> {
  const actor = await requirePermission("gl.jv_prepare");
  try {
    const { jeId } = jeIdSchema.parse(input);
    await withTx((tx) => discardJvDraft(tx, jeId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [LedgerError]);
  }
}

// ── Chart of accounts (T3.6) ─────────────────────────────────────────────────────────────────

const accountSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20).regex(/^[0-9A-Za-z.-]+$/, "Use letters, digits, dot or dash"),
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  normalBalance: z.enum(["DR", "CR"]),
  parentId: z.uuid().nullable(),
  isPostable: z.boolean(),
  scaCode: z.string().trim().max(20).nullable(),
});
const accountUpdateSchema = z.object({ accountId: z.uuid(), name: accountSchema.shape.name, scaCode: accountSchema.shape.scaCode, parentId: z.uuid().nullable() });
const accountActiveSchema = z.object({ accountId: z.uuid(), active: z.boolean() });

export async function createAccountAction(input: z.input<typeof accountSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = accountSchema.parse(input);
    const a = await withTx((tx) => createAccount(tx, data, actor.id));
    return ok({ id: a.id });
  } catch (e) {
    return failFrom(e, [CoaError]);
  }
}

export async function updateAccountAction(input: z.input<typeof accountUpdateSchema>): Promise<ActionResult> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = accountUpdateSchema.parse(input);
    await withTx((tx) => updateAccount(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [CoaError]);
  }
}

export async function setAccountActiveAction(input: z.input<typeof accountActiveSchema>): Promise<ActionResult> {
  const actor = await requirePermission("gl.coa");
  try {
    const { accountId, active } = accountActiveSchema.parse(input);
    await withTx((tx) => setAccountActive(tx, accountId, active, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [CoaError]);
  }
}
