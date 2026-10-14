import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { businessToday, isBusinessDate, monthEnd, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { accounts, journalEntries, journalLines } from "@/modules/ledger/schema";
import { AccountingError } from "./assets";
import { bankAccounts, bankRecons, bankStatementLines, bankStatements, fsLineAccounts, fsLines } from "./schema";

/**
 * Bank reconciliation (PHASE-14 T14.4). Each bank account has its own cash GL account. For a month,
 * the bookkeeper enters the statement's ending balance, ticks the book entries the bank cleared and
 * adds the bank-only items (charges, interest) the book doesn't have yet. It is saved only when
 * bank balance + deposits in transit − outstanding checks = book balance + bank-only items.
 */

const POSTED = ["POSTED", "REVERSED"] as const;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A bank account; its GL account must be a cash account (on the Cash and cash equivalents line). */
export async function createBankAccount(tx: Tx, input: { name: string; bankName: string; accountNo: string; glAccountId: string }, actorId: string) {
  const name = input.name.trim();
  const bankName = input.bankName.trim();
  const accountNo = input.accountNo.trim();
  if (!name || !bankName || !accountNo) throw new AccountingError("Enter the name, the bank and the account no.");
  const [gl] = await tx.select().from(accounts).where(eq(accounts.id, input.glAccountId));
  if (!gl || !gl.isPostable || !gl.isActive) throw new AccountingError("Choose an active postable GL account");
  const [line] = await tx.select({ cashFlow: fsLines.cashFlow }).from(fsLineAccounts).innerJoin(fsLines, eq(fsLines.id, fsLineAccounts.fsLineId)).where(eq(fsLineAccounts.accountId, gl.id));
  if (line?.cashFlow !== "CASH") throw new AccountingError(`${gl.code} ${gl.name} isn't a cash account`);
  const [dup] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.glAccountId, gl.id));
  if (dup) throw new AccountingError(`${gl.code} ${gl.name} already belongs to a bank account`);
  const [b] = await tx.insert(bankAccounts).values({ name, bankName, accountNo, glAccountId: gl.id, createdBy: actorId }).returning();
  if (!b) throw new Error("bank account insert returned no row");
  await audit(tx, { action: "bank.account_create", entity: "bank_account", entityId: b.id, after: { name, bankName, accountNo, gl: gl.code }, userId: actorId });
  return { id: b.id };
}

export async function listBankAccounts(db: Db | Tx = getDb()) {
  return db.select({ bank: bankAccounts, glCode: accounts.code, glName: accounts.name }).from(bankAccounts).innerJoin(accounts, eq(accounts.id, bankAccounts.glAccountId)).orderBy(asc(bankAccounts.name));
}

/** The book balance at the month's end and the book entries not yet cleared by the bank. */
export async function reconData(bankAccountId: string, period: string, db: Db | Tx = getDb()) {
  if (!PERIOD_RE.test(period)) throw new AccountingError("Choose the month (YYYY-MM)");
  const [bank] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId));
  if (!bank) throw new AccountingError("Bank account not found");
  const end = monthEnd(`${period}-01`);
  const [bal] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(eq(journalLines.accountId, bank.glAccountId), inArray(journalEntries.status, [...POSTED]), lte(journalEntries.entryDate, end)));
  const open = await db
    .select({ id: journalLines.id, date: journalEntries.entryDate, jeNo: journalEntries.jeNo, reference: journalEntries.reference, particulars: journalEntries.particulars, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .leftJoin(bankStatementLines, eq(bankStatementLines.matchedLineId, journalLines.id))
    .where(and(eq(journalLines.accountId, bank.glAccountId), inArray(journalEntries.status, [...POSTED]), lte(journalEntries.entryDate, end), isNull(bankStatementLines.id)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.jeNo));
  const [saved] = await db.select().from(bankRecons).where(and(eq(bankRecons.bankAccountId, bank.id), eq(bankRecons.period, period)));
  return { bank, period, end, bookBalance: BigInt(bal?.s ?? "0"), open, saved: saved ?? null };
}

export type BankItem = { date: BusinessDate; description: string; amount: Money };

/** Saves the month's reconciliation (once) when it balances; the cleared entries are matched to the statement. */
export async function saveRecon(tx: Tx, input: { bankAccountId: string; period: string; bankBalance: Money; clearedLineIds: string[]; bankItems: BankItem[] }, actorId: string) {
  const data = await reconData(input.bankAccountId, input.period, tx);
  if (data.end > businessToday()) throw new AccountingError(`${input.period} isn't over yet`);
  if (data.saved) throw new AccountingError(`${data.bank.name} is already reconciled for ${input.period}`);
  const openById = new Map(data.open.map((l) => [l.id, l]));
  const cleared = [...new Set(input.clearedLineIds)];
  for (const id of cleared) if (!openById.has(id)) throw new AccountingError("A ticked entry isn't an open entry of this bank account");
  for (const [i, item] of input.bankItems.entries()) {
    if (!isBusinessDate(item.date) || item.date > data.end || !item.description.trim() || item.amount === 0n) throw new AccountingError(`Bank-only item ${i + 1}: enter its date (in the month), what it is and its amount`);
  }
  const outstanding = data.open.filter((l) => !cleared.includes(l.id));
  const depositsInTransit = outstanding.reduce((s, l) => s + l.debit, 0n);
  const outstandingChecks = outstanding.reduce((s, l) => s + l.credit, 0n);
  const adjustments = input.bankItems.reduce((s, i) => s + i.amount, 0n);
  const difference = input.bankBalance + depositsInTransit - outstandingChecks - (data.bookBalance + adjustments);
  if (difference !== 0n) throw new AccountingError(`It doesn't reconcile: the adjusted bank balance differs from the adjusted book balance by ${format(difference)}`);
  const [stmt] = await tx.insert(bankStatements).values({ bankAccountId: data.bank.id, period: input.period, endingBalance: input.bankBalance, createdBy: actorId }).returning();
  if (!stmt) throw new Error("statement insert returned no row");
  const rows = [
    ...cleared.map((id) => {
      const l = openById.get(id)!;
      return { statementId: stmt.id, lineDate: l.date, description: `${l.jeNo ?? ""} ${l.reference ?? l.particulars}`.trim(), amount: l.debit - l.credit, matchedLineId: l.id, createdBy: actorId };
    }),
    ...input.bankItems.map((i) => ({ statementId: stmt.id, lineDate: i.date, description: i.description.trim(), amount: i.amount, matchedLineId: null, createdBy: actorId })),
  ];
  if (rows.length) await tx.insert(bankStatementLines).values(rows);
  const [recon] = await tx
    .insert(bankRecons)
    .values({
      bankAccountId: data.bank.id,
      period: input.period,
      bookBalance: data.bookBalance,
      bankBalance: input.bankBalance,
      depositsInTransit,
      outstandingChecks,
      adjustments,
      difference,
      details: {
        outstanding: outstanding.map((l) => ({ date: l.date, jeNo: l.jeNo, reference: l.reference, debit: String(l.debit), credit: String(l.credit) })),
        bankItems: input.bankItems.map((i) => ({ date: i.date, description: i.description, amount: String(i.amount) })),
      },
      savedBy: actorId,
      createdBy: actorId,
    })
    .returning();
  if (!recon) throw new Error("recon insert returned no row");
  await audit(tx, { action: "bank.reconcile", entity: "bank_account", entityId: data.bank.id, after: { period: input.period, book: format(data.bookBalance), bank: format(input.bankBalance), dit: format(depositsInTransit), oc: format(outstandingChecks), adjustments: format(adjustments) }, userId: actorId });
  return { id: recon.id, depositsInTransit, outstandingChecks, adjustments };
}

/** Whether every active bank account is reconciled for the month: for the month-close checklist. */
export async function reconsDone(period: string, db: Db | Tx = getDb()): Promise<{ ok: boolean; detail: string }> {
  const banks = await db.select().from(bankAccounts).where(eq(bankAccounts.isActive, true));
  if (banks.length === 0) return { ok: true, detail: "No bank accounts set up" };
  const done = await db.select({ id: bankRecons.bankAccountId }).from(bankRecons).where(eq(bankRecons.period, period));
  const missing = banks.filter((b) => !done.some((d) => d.id === b.id));
  return missing.length ? { ok: false, detail: `Not reconciled: ${missing.map((b) => b.name).join(", ")}` } : { ok: true, detail: `${banks.length} reconciled` };
}
