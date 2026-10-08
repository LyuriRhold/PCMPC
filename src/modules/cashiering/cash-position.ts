import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { addDays, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { journalEntries, journalLines } from "@/modules/ledger/schema";
import { accountBalance, accountIdFor } from "@/modules/ledger/service";
import { cashOutType, receiptItem } from "./registry";
import { cashOuts, receiptItems, receipts } from "./schema";

export type PositionLine = { type: string; label: string; amount: Money; count: number };
export type OtherLine = { jeId: string; jeNo: string | null; particulars: string; amount: Money };

/** Entries the counter itself posts; they are counted through receipts and cash-outs. */
const COUNTER_SOURCES = ["cashiering", "cashiering.dv", "cashiering.deposit"];

/**
 * Daily cash position for Cash on Hand, built from the counter's own records:
 *   beginning (GL as of the day before) + receipts by item type − cash-outs by type
 *   + other postings to Cash on Hand (short/over, manual JVs, … listed one by one) = ending,
 * and `reconciled` says whether that ending equals the GL balance as of the date.
 */
export async function cashPosition(date: BusinessDate, db: Db | Tx = getDb()) {
  const cash = await accountIdFor("cash_on_hand", db);
  const beginning = (await accountBalance(cash, addDays(date, -1), db)).net;

  const inRows = await db
    .select({ type: receiptItems.type, amount: sql<string>`sum(${receiptItems.amount})::text`, count: sql<number>`count(distinct ${receipts.id})::int` })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(receipts.receiptDate, date), eq(receipts.status, "VALID"), inArray(receipts.mode, ["CASH", "CHECK"])))
    .groupBy(receiptItems.type)
    .orderBy(asc(receiptItems.type));
  const outRows = await db
    .select({ type: cashOuts.type, amount: sql<string>`sum(${cashOuts.amount})::text`, count: sql<number>`count(*)::int` })
    .from(cashOuts)
    .where(eq(cashOuts.outDate, date))
    .groupBy(cashOuts.type)
    .orderBy(asc(cashOuts.type));
  const receiptsIn: PositionLine[] = inRows.map((r) => ({ type: r.type, label: receiptItem(r.type)?.label ?? r.type, amount: BigInt(r.amount), count: r.count }));
  const outs: PositionLine[] = outRows.map((r) => ({ type: r.type, label: cashOutType(r.type)?.label ?? r.type, amount: BigInt(r.amount), count: r.count }));
  const totalIn = receiptsIn.reduce((s, r) => s + r.amount, 0n);
  const totalOut = outs.reduce((s, r) => s + r.amount, 0n);

  const otherRows = await db
    .select({
      jeId: journalEntries.id,
      jeNo: journalEntries.jeNo,
      particulars: journalEntries.particulars,
      amount: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})::text`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(
      and(
        eq(journalLines.accountId, cash),
        eq(journalEntries.entryDate, date),
        inArray(journalEntries.status, ["POSTED", "REVERSED"]),
        notInArray(journalEntries.sourceModule, COUNTER_SOURCES),
      ),
    )
    .groupBy(journalEntries.id)
    .orderBy(asc(journalEntries.jeNo));
  const other: OtherLine[] = otherRows.map((r) => ({ ...r, amount: BigInt(r.amount) }));
  const totalOther = other.reduce((s, o) => s + o.amount, 0n);

  const ending = beginning + totalIn - totalOut + totalOther;
  const gl = (await accountBalance(cash, date, db)).net;
  return { date, beginning, receipts: receiptsIn, totalIn, cashOuts: outs, totalOut, other, totalOther, ending, gl, reconciled: ending === gl };
}
