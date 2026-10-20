import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { addMonths, formatDate, monthEnd, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { fiscalYearStart } from "@/modules/ledger/periods";
import { accountMappings, accounts, journalEntries } from "@/modules/ledger/schema";
import { loanProducts } from "@/modules/loans/schema";
import { depositProducts } from "@/modules/savings/schema";
import { costOf } from "@/modules/store/stock";
import {
  importBatches,
  stgLoans,
  stgMembers,
  stgSavings,
  stgShareCapital,
  stgStoreAr,
  stgStoreStock,
  stgSuppliers,
  stgTimeDeposits,
  stgTrialBalance,
  stgWaterAccounts,
  stgWaterBills,
  type BatchStatus,
  type MigrationEntity,
} from "./schema";
import { TEMPLATES } from "./templates";

/**
 * The reconciliation (PHASE-17 T17.4): for every control account (each GL account kept by member,
 * water customer or supplier, and Merchandise Inventory), the cut-off trial balance next to the
 * total of the staged subsidiary records. Posting is blocked until every one agrees to the centavo.
 */

/** The rows of the files staged (or, once posted, posted) for a cut-off. */
export async function stagedData(cutoff: BusinessDate, db: Db | Tx = getDb()) {
  const all = await db
    .select({ id: importBatches.id, entity: importBatches.entity, fileName: importBatches.fileName, status: importBatches.status, rowCount: importBatches.rowCount })
    .from(importBatches)
    .where(and(eq(importBatches.cutoffDate, cutoff), inArray(importBatches.status, ["UPLOADED", "VALIDATED", "STAGED", "POSTED"])))
    .orderBy(asc(importBatches.createdAt));
  const posted = all.some((b) => b.status === "POSTED");
  const status: BatchStatus = posted ? "POSTED" : "STAGED";
  const batches = all.filter((b) => b.status === status);
  const ids = (e: MigrationEntity) => batches.filter((b) => b.entity === e).map((b) => b.id);
  const rows = async <T>(e: MigrationEntity, load: (batchIds: string[]) => Promise<T[]>): Promise<T[]> => (ids(e).length ? load(ids(e)) : []);
  return {
    posted,
    batches,
    /** Files uploaded for the cut-off but not staged (they hold up posting). */
    unstaged: posted ? [] : all.filter((b) => b.status === "UPLOADED" || b.status === "VALIDATED"),
    members: await rows("members", (b) => db.select().from(stgMembers).where(inArray(stgMembers.batchId, b)).orderBy(asc(stgMembers.rowNo))),
    share: await rows("share_capital", (b) => db.select().from(stgShareCapital).where(inArray(stgShareCapital.batchId, b)).orderBy(asc(stgShareCapital.rowNo))),
    savings: await rows("savings", (b) => db.select().from(stgSavings).where(inArray(stgSavings.batchId, b)).orderBy(asc(stgSavings.rowNo))),
    timeDeposits: await rows("time_deposits", (b) => db.select().from(stgTimeDeposits).where(inArray(stgTimeDeposits.batchId, b)).orderBy(asc(stgTimeDeposits.rowNo))),
    loans: await rows("loans", (b) => db.select().from(stgLoans).where(inArray(stgLoans.batchId, b)).orderBy(asc(stgLoans.rowNo))),
    waterAccounts: await rows("water_accounts", (b) => db.select().from(stgWaterAccounts).where(inArray(stgWaterAccounts.batchId, b)).orderBy(asc(stgWaterAccounts.rowNo))),
    waterBills: await rows("water_bills", (b) => db.select().from(stgWaterBills).where(inArray(stgWaterBills.batchId, b)).orderBy(asc(stgWaterBills.rowNo))),
    stock: await rows("store_stock", (b) => db.select().from(stgStoreStock).where(inArray(stgStoreStock.batchId, b)).orderBy(asc(stgStoreStock.rowNo))),
    suppliers: await rows("suppliers", (b) => db.select().from(stgSuppliers).where(inArray(stgSuppliers.batchId, b)).orderBy(asc(stgSuppliers.rowNo))),
    storeAr: await rows("store_ar", (b) => db.select().from(stgStoreAr).where(inArray(stgStoreAr.batchId, b)).orderBy(asc(stgStoreAr.rowNo))),
    tb: await rows("trial_balance", (b) => db.select().from(stgTrialBalance).where(inArray(stgTrialBalance.batchId, b)).orderBy(asc(stgTrialBalance.rowNo))),
  };
}

export type StagedData = Awaited<ReturnType<typeof stagedData>>;

/** The subsidiary total of each GL mapping key, from the staged records. */
export async function subledgerByKey(data: StagedData, db: Db | Tx = getDb()): Promise<Map<string, Money>> {
  const totals = new Map<string, Money>();
  const add = (key: string, amount: Money) => totals.set(key, (totals.get(key) ?? 0n) + amount);
  const deposit = new Map((await db.select({ code: depositProducts.code, kind: depositProducts.kind, key: depositProducts.depositGlKey }).from(depositProducts)).map((p) => [p.code.toUpperCase(), p]));
  const tdKey = [...deposit.values()].find((p) => p.kind === "TIME")?.key ?? "time_deposits";
  const loanKey = new Map((await db.select({ code: loanProducts.code, key: loanProducts.receivableGlKey }).from(loanProducts)).map((p) => [p.code.toUpperCase(), p.key]));
  for (const s of data.share) {
    add("subscribed_share_capital_common", s.subscribed);
    add("subscription_receivable_common", s.subscribed - s.paidUp);
  }
  for (const s of data.savings) add(deposit.get(s.productCode)?.key ?? "savings_deposits", s.balance);
  for (const t of data.timeDeposits) add(tdKey, t.principal);
  for (const l of data.loans) add(loanKey.get(l.productCode) ?? `loans_receivable_${l.productCode}`, l.outstandingPrincipal);
  for (const a of data.storeAr) add("accounts_receivable_members", a.balance);
  for (const b of data.waterBills) add("ar_water", b.amount);
  for (const w of data.waterAccounts) {
    add("customers_deposits", w.deposit);
    add("customers_advances", w.advance);
  }
  for (const s of data.suppliers) add("accounts_payable_trade", s.balance);
  for (const s of data.stock) if (s.quantity > 0) add("merchandise_inventory", costOf(s.quantity, s.unitCost));
  return totals;
}

export type ReconRow = { accountId: string; code: string; name: string; normal: "DR" | "CR"; keys: string[]; tb: Money; subledger: Money; difference: Money };

/** The control accounts: kept by member, customer or supplier, Merchandise Inventory, and any account a staged record posts to. */
async function controlAccounts(db: Db | Tx, keys: string[]) {
  return db
    .select({ key: accountMappings.key, accountId: accounts.id, code: accounts.code, name: accounts.name, normal: accounts.normalBalance })
    .from(accountMappings)
    .innerJoin(accounts, eq(accounts.id, accountMappings.accountId))
    .where(
      or(
        eq(accountMappings.requiresMember, true),
        eq(accountMappings.requiresCustomer, true),
        eq(accountMappings.requiresSupplier, true),
        keys.length ? inArray(accountMappings.key, ["merchandise_inventory", ...keys]) : eq(accountMappings.key, "merchandise_inventory"),
      ),
    )
    .orderBy(asc(accounts.code));
}

/** Rows of the reconciliation, and what (if anything) holds up posting. */
export async function reconciliation(cutoff: BusinessDate, db: Db | Tx = getDb()) {
  const data = await stagedData(cutoff, db);
  const sub = await subledgerByKey(data, db);
  const byAccount = new Map<string, ReconRow>();
  for (const m of await controlAccounts(db, [...sub.keys()])) {
    const row = byAccount.get(m.accountId) ?? { accountId: m.accountId, code: m.code, name: m.name, normal: m.normal, keys: [], tb: 0n, subledger: 0n, difference: 0n };
    row.keys.push(m.key);
    row.subledger += sub.get(m.key) ?? 0n;
    byAccount.set(m.accountId, row);
  }
  for (const t of data.tb) {
    const row = byAccount.get(t.accountId);
    if (row) row.tb += row.normal === "DR" ? t.debit - t.credit : t.credit - t.debit;
  }
  const rows = [...byAccount.values()].map((r) => ({ ...r, difference: r.tb - r.subledger })).sort((a, z) => a.code.localeCompare(z.code));
  const unknownKeys = [...sub.entries()].filter(([key, amount]) => amount !== 0n && !rows.some((r) => r.keys.includes(key))).map(([key]) => key);

  const tbDebit = data.tb.reduce((s, t) => s + t.debit, 0n);
  const tbCredit = data.tb.reduce((s, t) => s + t.credit, 0n);
  const blockers: string[] = [];
  if (!data.posted) {
    if (!data.batches.some((b) => b.entity === "trial_balance")) blockers.push("Stage the trial balance as of the cut-off");
    if (tbDebit !== tbCredit) blockers.push(`The trial balance doesn't balance (debits ${format(tbDebit)}, credits ${format(tbCredit)})`);
    for (const b of data.unstaged) blockers.push(`Stage or roll back the ${TEMPLATES[b.entity].title} file ${b.fileName}`);
    for (const r of rows.filter((x) => x.difference !== 0n)) {
      blockers.push(`${r.code} ${r.name}: the trial balance has ${format(r.tb)} and the subsidiary records ${format(r.subledger)} (difference ${format(r.difference)})`);
    }
    // At a fiscal year end the books are closed: the trial balance must be the post-closing one.
    if (data.tb.length && monthEnd(addMonths(await fiscalYearStart(cutoff, db), 11)) === cutoff) {
      const ids = data.tb.map((t) => t.accountId);
      const nominal = await db.select({ code: accounts.code }).from(accounts).where(and(inArray(accounts.id, ids), inArray(accounts.type, ["REVENUE", "EXPENSE"])));
      if (nominal.length) blockers.push(`${formatDate(cutoff)} is a fiscal year end: stage the post-closing trial balance (revenues and expenses closed into Undivided Net Surplus; ${nominal.map((n) => n.code).join(", ")} have balances)`);
    }
    for (const key of unknownKeys) blockers.push(`No account is mapped to "${key}" for the staged records`);
    const [entries] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(and(inArray(journalEntries.status, ["POSTED", "REVERSED"]), lte(journalEntries.entryDate, cutoff)));
    if ((entries?.n ?? 0) > 0) blockers.push(`The ledger already has ${entries?.n} entr${entries?.n === 1 ? "y" : "ies"} dated on or before ${formatDate(cutoff)}; the opening balances must be the first entry`);
  }
  return {
    cutoffDate: cutoff,
    posted: data.posted,
    batches: data.batches,
    rows,
    tbDebit,
    tbCredit,
    blockers,
    canPost: !data.posted && blockers.length === 0,
  };
}

export type Reconciliation = Awaited<ReturnType<typeof reconciliation>>;
