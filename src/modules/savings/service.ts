import { and, asc, desc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addDays, addMonths, businessToday, daysBetween, formatDate, type BusinessDate } from "@/lib/dates";
import { runOnce } from "@/lib/jobs";
import { format, type Money } from "@/lib/money";
import { normalizeName } from "@/lib/names";
import { next as nextNumber } from "@/lib/numbering";
import { payOut } from "@/modules/cashiering/service";
import { journalEntries } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { members } from "@/modules/members/schema";
import { registerTerminationRule } from "@/modules/members/termination";
import { averageDailyBalance, balanceDays, quarterEnding, savingsInterest, simpleInterest, withholdingTax } from "./interest";
import { depositAccounts, depositProducts, depositTransactions, timeDeposits, type DepositAccount, type DepositProduct, type DepositTxnType, type TimeDeposit } from "./schema";

/**
 * Savings and time deposits (PHASE-09 T9.2–T9.5). Every money movement posts its journal entry in
 * the same transaction as its passbook rows; cash goes through the teller (receipt item
 * SAVINGS_DEPOSIT, cash-out SAVINGS_WITHDRAWAL). Time deposits are funded from, and pay back into,
 * the member's savings account (CONFIRM Q-09.3).
 */

/** A savings rule was broken; the message is safe to show. */
export class SavingsError extends Error {
  override name = "SavingsError";
}

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;

// ── Lookups ──

export async function productByCode(code: string, db: Db | Tx = getDb()): Promise<DepositProduct | undefined> {
  const [p] = await db.select().from(depositProducts).where(eq(depositProducts.code, code));
  return p;
}

export async function listProducts(db: Db | Tx = getDb()): Promise<DepositProduct[]> {
  return db.select().from(depositProducts).orderBy(asc(depositProducts.kind), asc(depositProducts.code));
}

export async function getAccount(accountId: string, db: Db | Tx = getDb()): Promise<DepositAccount | undefined> {
  const [a] = await db.select().from(depositAccounts).where(eq(depositAccounts.id, accountId));
  return a;
}

/** The current balance (the last passbook row's balance), 0 for a new account. */
export async function accountBalance(accountId: string, db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await db.select({ b: depositTransactions.balanceAfter }).from(depositTransactions).where(eq(depositTransactions.accountId, accountId)).orderBy(desc(depositTransactions.seq)).limit(1);
  return r?.b ?? 0n;
}

async function lockMember(tx: Tx, memberId: string): Promise<MemberRow> {
  const [m] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (!m) throw new SavingsError("Member not found");
  return m;
}

type Locked = { account: DepositAccount; product: DepositProduct; member: MemberRow };

/** Locks the account row (deposits, withdrawals, interest and closing on one account run one at a time). */
async function lockAccount(tx: Tx, accountId: string): Promise<Locked> {
  const [row] = await tx
    .select({ account: depositAccounts, product: depositProducts, member: members })
    .from(depositAccounts)
    .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .where(eq(depositAccounts.id, accountId))
    .for("update", { of: depositAccounts });
  if (!row) throw new SavingsError("Deposit account not found");
  return row;
}

function assertSavings(l: Locked): void {
  if (l.product.kind !== "SAVINGS") throw new SavingsError(`${l.account.accountNo} is a time deposit; use the time-deposit actions`);
}

/** Writes one passbook row; the balance after it can't go below zero. */
async function post(
  tx: Tx,
  row: { accountId: string; type: DepositTxnType; amount: Money; date: BusinessDate; jeId: string; refNo?: string | null; birReceiptNo?: string | null; receiptItemId?: string | null; remarks?: string | null },
  actorId: string | null,
): Promise<Money> {
  const balanceAfter = (await accountBalance(row.accountId, tx)) + row.amount;
  if (balanceAfter < 0n) throw new SavingsError("The balance can't go below zero");
  await tx.insert(depositTransactions).values({
    accountId: row.accountId,
    txnDate: row.date,
    type: row.type,
    amount: row.amount,
    balanceAfter,
    refNo: row.refNo ?? null,
    birReceiptNo: row.birReceiptNo ?? null,
    receiptItemId: row.receiptItemId ?? null,
    jeId: row.jeId,
    remarks: row.remarks ?? null,
    createdBy: actorId,
  });
  return balanceAfter;
}

// ── Products (configuration) ──

export type ProductChanges = { name: string; ratePa: string; minBalanceEarn: Money; maintainingBalance: Money; dormantAfterMonths: number | null; wtaxRate: string; active: boolean };

/**
 * Changes a deposit product's rates and limits (Savings products page). New rates apply from the
 * next interest run or placement; placed time deposits keep their rate.
 */
export async function updateProduct(tx: Tx, input: { productId: string } & ProductChanges, actorId: string) {
  const [before] = await tx.select().from(depositProducts).where(eq(depositProducts.id, input.productId)).for("update");
  if (!before) throw new SavingsError("Deposit product not found");
  const name = input.name.trim();
  if (!name) throw new SavingsError("Enter the product name");
  for (const [label, rate] of [["interest rate", input.ratePa], ["withholding tax", input.wtaxRate]] as const) {
    if (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) > 1) throw new SavingsError(`Enter the ${label} as a percentage from 0% to 100%`);
  }
  if (input.minBalanceEarn < 0n || input.maintainingBalance < 0n) throw new SavingsError("Amounts can't be negative");
  if (before.kind === "SAVINGS" && (input.dormantAfterMonths === null || !Number.isInteger(input.dormantAfterMonths) || input.dormantAfterMonths < 1 || input.dormantAfterMonths > 120)) {
    throw new SavingsError("Enter the months without deposits or withdrawals before an account becomes dormant (1 to 120)");
  }
  const changes = {
    name,
    ratePa: input.ratePa,
    minBalanceEarn: input.minBalanceEarn,
    maintainingBalance: input.maintainingBalance,
    dormantAfterMonths: before.kind === "SAVINGS" ? input.dormantAfterMonths : null,
    wtaxRate: input.wtaxRate,
    active: input.active,
  };
  await tx.update(depositProducts).set(changes).where(eq(depositProducts.id, before.id));
  await audit(tx, {
    action: "savings.product_update",
    entity: "deposit_product",
    entityId: before.id,
    before: { name: before.name, ratePa: before.ratePa, minBalanceEarn: format(before.minBalanceEarn), maintainingBalance: format(before.maintainingBalance), dormantAfterMonths: before.dormantAfterMonths, wtaxRate: before.wtaxRate, active: before.active },
    after: { ...changes, minBalanceEarn: format(changes.minBalanceEarn), maintainingBalance: format(changes.maintainingBalance) },
    userId: actorId,
  });
}

// ── Accounts (T9.2) ──

/** Opens a savings account for an ACTIVE member; one regular savings account per member (CONFIRM Q-09.1). */
export async function openAccount(tx: Tx, input: { memberId: string; productId: string }, actorId: string) {
  const m = await lockMember(tx, input.memberId);
  if (m.status !== "ACTIVE" || !m.memberNo) throw new SavingsError("Member must be ACTIVE");
  const [product] = await tx.select().from(depositProducts).where(eq(depositProducts.id, input.productId));
  if (!product || !product.active) throw new SavingsError("Choose an active deposit product");
  if (product.kind !== "SAVINGS") throw new SavingsError("Time deposits are opened by placing one from the member's savings account");
  const [existing] = await tx
    .select({ accountNo: depositAccounts.accountNo })
    .from(depositAccounts)
    .where(and(eq(depositAccounts.memberId, m.id), eq(depositAccounts.productId, product.id), ne(depositAccounts.status, "CLOSED")));
  if (existing) throw new SavingsError(`${nameOf(m)} already has a ${product.name} account (${existing.accountNo})`);
  const date = businessToday();
  const accountNo = await nextNumber("SA", tx, date);
  const [a] = await tx.insert(depositAccounts).values({ accountNo, memberId: m.id, productId: product.id, openedAt: date, createdBy: actorId }).returning();
  if (!a) throw new Error("account insert returned no row");
  await audit(tx, { action: "savings.open", entity: "deposit_account", entityId: a.id, after: { accountNo, member: m.memberNo, product: product.code }, userId: actorId });
  return { id: a.id, accountNo };
}

/** Teller deposit, before the receipt is written: the account must be the payor's own and not closed. */
export async function checkDeposit(tx: Tx, input: { accountId: string; payorMemberId: string; amount: Money }) {
  const l = await lockAccount(tx, input.accountId);
  assertSavings(l);
  if (l.account.memberId !== input.payorMemberId) throw new SavingsError("Deposit to the payor's own savings account");
  if (l.account.status === "CLOSED") throw new SavingsError(`${l.account.accountNo} is closed`);
  if (input.amount <= 0n) throw new SavingsError("The amount must be more than zero");
  const glAccount = await accountIdFor(l.product.depositGlKey, tx);
  return { account: l.account, creditLines: [{ accountId: glAccount, credit: input.amount, memberId: l.account.memberId }] satisfies LineInput[] };
}

/** Records a teller deposit after its receipt (and entry) exist. A DORMANT account becomes OPEN again. */
export async function recordDeposit(tx: Tx, input: { accountId: string; amount: Money; receiptItemId: string; jeId: string; date: BusinessDate; receiptNo: string; birReceiptNo: string | null }, actorId: string) {
  const { account } = await lockAccount(tx, input.accountId);
  await post(tx, { accountId: account.id, type: "DEPOSIT", amount: input.amount, date: input.date, jeId: input.jeId, refNo: input.receiptNo, birReceiptNo: input.birReceiptNo, receiptItemId: input.receiptItemId }, actorId);
  await tx.update(depositAccounts).set({ lastCustomerTxnAt: input.date, ...(account.status === "DORMANT" ? { status: "OPEN" as const } : {}) }).where(eq(depositAccounts.id, account.id));
  if (account.status === "DORMANT") {
    await audit(tx, { action: "savings.reactivate", entity: "deposit_account", entityId: account.id, after: { by: "deposit", receiptNo: input.receiptNo }, userId: actorId });
  }
}

/** A cancelled deposit receipt: the money comes back out of the passbook, unless it was already withdrawn. */
export async function reverseDeposit(tx: Tx, input: { accountId: string; amount: Money; receiptNo: string; date: BusinessDate; jeId: string }, actorId: string) {
  const { account } = await lockAccount(tx, input.accountId);
  const balance = await accountBalance(account.id, tx);
  if (balance < input.amount) throw new SavingsError(`Only ${format(balance)} is left in ${account.accountNo}; the deposit was already withdrawn, so the receipt can't be cancelled`);
  await post(tx, { accountId: account.id, type: "ADJUSTMENT", amount: -input.amount, date: input.date, jeId: input.jeId, refNo: input.receiptNo, remarks: `Receipt ${input.receiptNo} cancelled` }, actorId);
}

/** Teller withdrawal: cash out of the drawer, never below the maintaining balance. DORMANT accounts must be reactivated first. */
export async function withdraw(tx: Tx, input: { accountId: string; amount: Money }, tellerId: string) {
  const l = await lockAccount(tx, input.accountId);
  assertSavings(l);
  const { account, product, member } = l;
  if (account.status === "DORMANT") throw new SavingsError(`${account.accountNo} is dormant; it must be reactivated first`);
  if (account.status === "CLOSED") throw new SavingsError(`${account.accountNo} is closed`);
  if (input.amount <= 0n) throw new SavingsError("The amount must be more than zero");
  const balance = await accountBalance(account.id, tx);
  if (balance - input.amount < product.maintainingBalance) {
    throw new SavingsError(`Withdrawal would breach the maintaining balance ${format(product.maintainingBalance)} (balance ${format(balance)}; at most ${format(balance > product.maintainingBalance ? balance - product.maintainingBalance : 0n)} can be withdrawn)`);
  }
  const date = businessToday();
  const glAccount = await accountIdFor(product.depositGlKey, tx);
  const { jeId } = await payOut(
    tx,
    {
      type: "SAVINGS_WITHDRAWAL",
      refId: account.id,
      reference: account.accountNo,
      particulars: `Savings withdrawal · ${account.accountNo} · ${member.memberNo} ${nameOf(member)}`,
      amount: input.amount,
      debitLines: [{ accountId: glAccount, debit: input.amount, memberId: member.id }],
      source: { module: "savings", id: account.id },
    },
    tellerId,
  );
  const balanceAfter = await post(tx, { accountId: account.id, type: "WITHDRAWAL", amount: -input.amount, date, jeId, refNo: account.accountNo }, tellerId);
  await tx.update(depositAccounts).set({ lastCustomerTxnAt: date }).where(eq(depositAccounts.id, account.id));
  await audit(tx, { action: "savings.withdraw", entity: "deposit_account", entityId: account.id, after: { amount: format(input.amount), balance: format(balanceAfter) }, userId: tellerId });
  return { jeId, balance: balanceAfter };
}

/**
 * Closes a savings account: the whole balance is paid out in cash (the maintaining balance no longer
 * applies) and no interest is credited for the part of the quarter (CONFIRM Q-09.4). Time deposits
 * paying back into it must end first.
 */
export async function closeAccount(tx: Tx, input: { accountId: string }, tellerId: string) {
  const l = await lockAccount(tx, input.accountId);
  assertSavings(l);
  const { account, product, member } = l;
  if (account.status === "CLOSED") throw new SavingsError(`${account.accountNo} is already closed`);
  if (account.status === "DORMANT") throw new SavingsError(`${account.accountNo} is dormant; it must be reactivated first`);
  const [td] = await tx.select({ no: timeDeposits.certificateNo }).from(timeDeposits).where(and(eq(timeDeposits.savingsAccountId, account.id), eq(timeDeposits.status, "ACTIVE"))).limit(1);
  if (td) throw new SavingsError(`Time deposit ${td.no} pays back into ${account.accountNo}; end it first`);
  const balance = await accountBalance(account.id, tx);
  const date = businessToday();
  let jeId: string | null = null;
  if (balance > 0n) {
    ({ jeId } = await payOut(
      tx,
      {
        type: "SAVINGS_WITHDRAWAL",
        refId: account.id,
        reference: account.accountNo,
        particulars: `Savings account closed · ${account.accountNo} · ${member.memberNo} ${nameOf(member)}`,
        amount: balance,
        debitLines: [{ accountId: await accountIdFor(product.depositGlKey, tx), debit: balance, memberId: member.id }],
        source: { module: "savings", id: account.id },
      },
      tellerId,
    ));
    await post(tx, { accountId: account.id, type: "WITHDRAWAL", amount: -balance, date, jeId, refNo: account.accountNo, remarks: "Account closed" }, tellerId);
  }
  await tx.update(depositAccounts).set({ status: "CLOSED", closedAt: date, lastCustomerTxnAt: date }).where(eq(depositAccounts.id, account.id));
  await audit(tx, { action: "savings.close", entity: "deposit_account", entityId: account.id, after: { paidOut: format(balance) }, userId: tellerId });
  return { jeId, paidOut: balance };
}

/** Reactivates a DORMANT account (manager); the dormancy period starts again today. */
export async function reactivate(tx: Tx, input: { accountId: string; reason: string }, actorId: string) {
  const { account } = await lockAccount(tx, input.accountId);
  if (account.status !== "DORMANT") throw new SavingsError(`${account.accountNo} is ${account.status}, not dormant`);
  const reason = input.reason.trim();
  if (!reason) throw new SavingsError("Enter why the account is reactivated (e.g. the member came in with an ID)");
  await tx.update(depositAccounts).set({ status: "OPEN", lastCustomerTxnAt: businessToday() }).where(eq(depositAccounts.id, account.id));
  await audit(tx, { action: "savings.reactivate", entity: "deposit_account", entityId: account.id, after: { reason }, userId: actorId });
}

export type LedgerRow = { id: string; date: BusinessDate; type: DepositTxnType; amount: Money; balanceAfter: Money; refNo: string | null; jeNo: string | null; remarks: string | null };

/** The passbook: rows in posting order with the balance after each (optionally a date range). */
export async function depositLedger(accountId: string, range: { from?: BusinessDate; to?: BusinessDate } = {}, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ t: depositTransactions, jeNo: journalEntries.jeNo })
    .from(depositTransactions)
    .innerJoin(journalEntries, eq(journalEntries.id, depositTransactions.jeId))
    .where(eq(depositTransactions.accountId, accountId))
    .orderBy(asc(depositTransactions.seq));
  let opening = 0n;
  const out: LedgerRow[] = [];
  for (const { t, jeNo } of rows) {
    if (range.to && t.txnDate > range.to) continue;
    if (range.from && t.txnDate < range.from) {
      opening = t.balanceAfter;
      continue;
    }
    out.push({ id: t.id, date: t.txnDate, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, refNo: t.refNo, jeNo, remarks: t.remarks });
  }
  return { opening, rows: out, closing: out.at(-1)?.balanceAfter ?? opening };
}

/** A member's deposit accounts with product and balance (Savings tab). */
export async function memberAccounts(memberId: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ account: depositAccounts, product: depositProducts })
    .from(depositAccounts)
    .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
    .where(eq(depositAccounts.memberId, memberId))
    .orderBy(asc(depositProducts.kind), asc(depositAccounts.accountNo));
  const out = [];
  for (const r of rows) out.push({ ...r, balance: await accountBalance(r.account.id, db) });
  return out;
}

/** A member's time deposits, newest first. */
export async function memberTimeDeposits(memberId: string, db: Db | Tx = getDb()) {
  return db
    .select({ td: timeDeposits, accountNo: depositAccounts.accountNo })
    .from(timeDeposits)
    .innerJoin(depositAccounts, eq(depositAccounts.id, timeDeposits.accountId))
    .where(eq(depositAccounts.memberId, memberId))
    .orderBy(desc(timeDeposits.placementDate), desc(timeDeposits.createdAt));
}

/** Savings accounts of a payor member that can take a deposit (teller dues list). */
export async function depositableAccounts(memberId: string, db: Db | Tx = getDb()) {
  return db
    .select({ id: depositAccounts.id, accountNo: depositAccounts.accountNo, status: depositAccounts.status, productName: depositProducts.name })
    .from(depositAccounts)
    .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
    .where(and(eq(depositAccounts.memberId, memberId), eq(depositProducts.kind, "SAVINGS"), ne(depositAccounts.status, "CLOSED")))
    .orderBy(asc(depositAccounts.accountNo));
}

/** All deposit accounts with balances, by account no. (Savings accounts page; `status` filters, e.g. DORMANT). */
export async function accountRegistry(filters: { q?: string; status?: DepositAccount["status"]; page?: number }, db: Db | Tx = getDb()) {
  const conds = normalizeName(filters.q)
    .split(" ")
    .filter(Boolean)
    .map((token) => or(sql`${members.searchText} LIKE ${`%${token}%`}`, sql`lower(${depositAccounts.accountNo}) LIKE ${`%${token}%`}`));
  if (filters.status) conds.push(eq(depositAccounts.status, filters.status));
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = 50;
  const page = Math.max(filters.page ?? 1, 1);
  const balance = sql<string>`coalesce((SELECT t.balance_after FROM deposit_transactions t WHERE t.account_id = ${depositAccounts.id} ORDER BY t.seq DESC LIMIT 1), 0)::text`;
  const [rows, [count], [totals]] = await Promise.all([
    db
      .select({ account: depositAccounts, productName: depositProducts.name, kind: depositProducts.kind, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName, balance })
      .from(depositAccounts)
      .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId))
      .innerJoin(members, eq(members.id, depositAccounts.memberId))
      .where(where)
      .orderBy(asc(depositAccounts.accountNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(depositAccounts).innerJoin(members, eq(members.id, depositAccounts.memberId)).where(where),
    db
      .select({
        savings: sql<string>`coalesce(sum(CASE WHEN ${depositProducts.kind} = 'SAVINGS' THEN ${balance}::bigint END), 0)::text`,
        time: sql<string>`coalesce(sum(CASE WHEN ${depositProducts.kind} = 'TIME' THEN ${balance}::bigint END), 0)::text`,
        dormant: sql<number>`count(*) FILTER (WHERE ${depositAccounts.status} = 'DORMANT')::int`,
      })
      .from(depositAccounts)
      .innerJoin(depositProducts, eq(depositProducts.id, depositAccounts.productId)),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, balance: BigInt(r.balance) })),
    total: count?.n ?? 0,
    page,
    pageSize,
    totals: { savings: BigInt(totals?.savings ?? "0"), time: BigInt(totals?.time ?? "0"), dormant: totals?.dormant ?? 0 },
  };
}

// ── Interest (T9.3) ──

export type InterestLine = { accountId: string; accountNo: string; memberId: string; memberNo: string | null; memberName: string; adb: Money; interest: Money; wtax: Money };

/**
 * Interest for one savings product and quarter, per account: ADB of the daily closing balances and
 * interest = ADB × rate × days ÷ 365 (HALF-UP per account; 0 below the minimum ADB). Accounts open
 * or dormant at the run earn; closed accounts don't (CONFIRM Q-09.4).
 */
export async function previewInterest(productId: string, periodEnd: BusinessDate, db: Db | Tx = getDb()): Promise<InterestLine[]> {
  const [product] = await db.select().from(depositProducts).where(eq(depositProducts.id, productId));
  if (!product) throw new SavingsError("Deposit product not found");
  if (product.kind !== "SAVINGS") throw new SavingsError("Interest runs are for savings products; time deposits earn at maturity");
  const quarter = quarterEnding(periodEnd);
  if (!quarter) throw new SavingsError("Choose a quarter end (Mar 31, Jun 30, Sep 30 or Dec 31)");
  const accounts = await db
    .select({ account: depositAccounts, member: members })
    .from(depositAccounts)
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .where(and(eq(depositAccounts.productId, product.id), inArray(depositAccounts.status, ["OPEN", "DORMANT"]), lte(depositAccounts.openedAt, quarter.end)))
    .orderBy(asc(depositAccounts.accountNo));
  const out: InterestLine[] = [];
  for (const { account, member } of accounts) {
    const [before] = await db
      .select({ b: depositTransactions.balanceAfter })
      .from(depositTransactions)
      .where(and(eq(depositTransactions.accountId, account.id), lt(depositTransactions.txnDate, quarter.start)))
      .orderBy(desc(depositTransactions.seq))
      .limit(1);
    const moves = await db
      .select({ date: depositTransactions.txnDate, amount: depositTransactions.amount })
      .from(depositTransactions)
      .where(and(eq(depositTransactions.accountId, account.id), sql`${depositTransactions.txnDate} BETWEEN ${quarter.start} AND ${quarter.end}`));
    const { sum, days } = balanceDays(before?.b ?? 0n, moves, quarter.start, quarter.end);
    const interest = savingsInterest({ sum, days, ratePa: product.ratePa, minBalanceEarn: product.minBalanceEarn });
    out.push({
      accountId: account.id,
      accountNo: account.accountNo,
      memberId: member.id,
      memberNo: member.memberNo,
      memberName: nameOf(member),
      adb: averageDailyBalance(sum, days),
      interest,
      wtax: withholdingTax(interest, product.wtaxRate),
    });
  }
  return out;
}

/**
 * Posts a quarter's interest for a savings product, once (job_runs key
 * `savings-interest:{product}:{periodEnd}`): one entry, Dr Interest Expense (total) / Cr Savings
 * Deposits per member (net of withholding tax) / Cr Withholding Tax Payable, dated the quarter end,
 * and an INTEREST (+ WTAX) passbook row per account that earned.
 */
export async function runInterest(tx: Tx, input: { productId: string; periodEnd: BusinessDate }, actorId: string) {
  const [product] = await tx.select().from(depositProducts).where(eq(depositProducts.id, input.productId));
  if (!product) throw new SavingsError("Deposit product not found");
  if (!quarterEnding(input.periodEnd)) throw new SavingsError("Choose a quarter end (Mar 31, Jun 30, Sep 30 or Dec 31)");
  if (input.periodEnd >= businessToday()) throw new SavingsError(`The quarter ending ${formatDate(input.periodEnd)} isn't over yet; run it from the next day`);
  return runOnce(
    tx,
    "savings-interest",
    `${product.code}:${input.periodEnd}`,
    actorId,
    async () => {
      // Lock the product's accounts so no deposit or withdrawal lands between the preview and the posting.
      await tx.select({ id: depositAccounts.id }).from(depositAccounts).where(eq(depositAccounts.productId, product.id)).for("update");
      const lines = (await previewInterest(product.id, input.periodEnd, tx)).filter((l) => l.interest > 0n);
      const total = lines.reduce((s, l) => s + l.interest, 0n);
      const wtax = lines.reduce((s, l) => s + l.wtax, 0n);
      if (lines.length === 0) {
        await audit(tx, { action: "savings.interest_run", entity: "deposit_product", entityId: product.id, after: { periodEnd: input.periodEnd, accounts: 0, total: format(0n) }, userId: actorId });
        return { jeId: null as string | null, accounts: 0, total: "0", wtax: "0" };
      }
      const deposits = await accountIdFor(product.depositGlKey, tx);
      const je = await postJournal(
        tx,
        {
          date: input.periodEnd,
          book: "GJ",
          particulars: `Savings interest · ${product.name} · quarter ending ${formatDate(input.periodEnd)} · ${lines.length} account(s)`,
          reference: `${product.code}-${input.periodEnd}`,
          source: { module: "savings-interest", id: product.id },
          lines: [
            { accountId: await accountIdFor(product.interestGlKey, tx), debit: total },
            ...lines.map((l) => ({ accountId: deposits, credit: l.interest - l.wtax, memberId: l.memberId, memo: l.accountNo })),
            ...(wtax > 0n ? [{ accountId: await accountIdFor(product.wtaxGlKey, tx), credit: wtax }] : []),
          ],
        },
        actorId,
      );
      for (const l of lines) {
        await post(tx, { accountId: l.accountId, type: "INTEREST", amount: l.interest, date: input.periodEnd, jeId: je.id, refNo: je.jeNo, remarks: `ADB ${format(l.adb)}` }, actorId);
        if (l.wtax > 0n) await post(tx, { accountId: l.accountId, type: "WTAX", amount: -l.wtax, date: input.periodEnd, jeId: je.id, refNo: je.jeNo }, actorId);
      }
      await audit(tx, { action: "savings.interest_run", entity: "deposit_product", entityId: product.id, after: { periodEnd: input.periodEnd, accounts: lines.length, total: format(total), wtax: format(wtax), jeNo: je.jeNo }, userId: actorId });
      return { jeId: je.id as string | null, accounts: lines.length, total: String(total), wtax: String(wtax) };
    },
    () => `Interest for ${product.name}, quarter ending ${formatDate(input.periodEnd)}, has already run`,
  );
}

// ── Time deposits (T9.4) ──

async function lockTd(tx: Tx, timeDepositId: string) {
  const [td] = await tx.select().from(timeDeposits).where(eq(timeDeposits.id, timeDepositId)).for("update");
  if (!td) throw new SavingsError("Time deposit not found");
  const tdAccount = await lockAccount(tx, td.accountId);
  const savings = await lockAccount(tx, td.savingsAccountId);
  return { td, tdAccount, savings };
}

/** Places a time deposit funded from the member's savings account (GJ Dr Savings Deposits / Cr Time Deposits). */
export async function placeTimeDeposit(tx: Tx, input: { memberId: string; productId: string; fromAccountId: string; principal: Money; termDays: number }, actorId: string) {
  const m = await lockMember(tx, input.memberId);
  if (m.status !== "ACTIVE" || !m.memberNo) throw new SavingsError("Member must be ACTIVE");
  const [product] = await tx.select().from(depositProducts).where(eq(depositProducts.id, input.productId));
  if (!product || !product.active || product.kind !== "TIME") throw new SavingsError("Choose an active time-deposit product");
  if (!Number.isInteger(input.termDays) || input.termDays < 1 || input.termDays > 3650) throw new SavingsError("Enter the term in days (1 to 3,650)");
  if (input.principal <= 0n) throw new SavingsError("The amount must be more than zero");
  const savings = await lockAccount(tx, input.fromAccountId);
  assertSavings(savings);
  if (savings.account.memberId !== m.id) throw new SavingsError("Fund the time deposit from the member's own savings account");
  if (savings.account.status !== "OPEN") throw new SavingsError(`${savings.account.accountNo} is ${savings.account.status}`);
  const balance = await accountBalance(savings.account.id, tx);
  if (balance - input.principal < savings.product.maintainingBalance) {
    throw new SavingsError(`${savings.account.accountNo} has ${format(balance)}; with the maintaining balance ${format(savings.product.maintainingBalance)}, at most ${format(balance > savings.product.maintainingBalance ? balance - savings.product.maintainingBalance : 0n)} can go into a time deposit`);
  }
  const date = businessToday();
  const accountNo = await nextNumber("TD", tx, date);
  const [tdAccount] = await tx.insert(depositAccounts).values({ accountNo, memberId: m.id, productId: product.id, openedAt: date, lastCustomerTxnAt: date, createdBy: actorId }).returning();
  if (!tdAccount) throw new Error("account insert returned no row");
  const certificateNo = `${accountNo}-1`;
  const je = await postJournal(
    tx,
    {
      date,
      book: "GJ",
      particulars: `Time deposit placed · ${certificateNo} · ${m.memberNo} ${nameOf(m)} · ${input.termDays} days at ${product.ratePa}`,
      reference: certificateNo,
      source: { module: "savings-td", id: tdAccount.id },
      lines: [
        { accountId: await accountIdFor(savings.product.depositGlKey, tx), debit: input.principal, memberId: m.id, memo: savings.account.accountNo },
        { accountId: await accountIdFor(product.depositGlKey, tx), credit: input.principal, memberId: m.id, memo: certificateNo },
      ],
    },
    actorId,
  );
  const [td] = await tx
    .insert(timeDeposits)
    .values({ accountId: tdAccount.id, certificateNo, principal: input.principal, ratePa: product.ratePa, termDays: input.termDays, placementDate: date, maturityDate: addDays(date, input.termDays), savingsAccountId: savings.account.id, jeId: je.id, createdBy: actorId })
    .returning();
  if (!td) throw new Error("time deposit insert returned no row");
  await post(tx, { accountId: savings.account.id, type: "TRANSFER_OUT", amount: -input.principal, date, jeId: je.id, refNo: certificateNo, remarks: `To time deposit ${certificateNo}` }, actorId);
  await post(tx, { accountId: tdAccount.id, type: "TRANSFER_IN", amount: input.principal, date, jeId: je.id, refNo: certificateNo, remarks: `From ${savings.account.accountNo}` }, actorId);
  await tx.update(depositAccounts).set({ lastCustomerTxnAt: date }).where(eq(depositAccounts.id, savings.account.id));
  await audit(tx, { action: "savings.td_place", entity: "time_deposit", entityId: td.id, after: { certificateNo, principal: format(input.principal), termDays: input.termDays, ratePa: product.ratePa, maturity: td.maturityDate }, userId: actorId });
  return { timeDepositId: td.id, accountId: tdAccount.id, certificateNo };
}

/**
 * Ends a certificate: interest (and withholding tax) is posted and, unless it is rolled over with
 * its interest, the money goes back to the savings account. One GJ entry.
 */
async function endTimeDeposit(tx: Tx, locked: Awaited<ReturnType<typeof lockTd>>, how: { status: "MATURED" | "PRETERMINATED" | "ROLLED_OVER"; interest: Money; days: number; rate: string; keepPrincipal: boolean; keepInterest: boolean }, actorId: string) {
  const { td, tdAccount, savings } = locked;
  const date = businessToday();
  const wtax = withholdingTax(how.interest, tdAccount.product.wtaxRate);
  const net = how.interest - wtax;
  const toSavings = (how.keepPrincipal ? 0n : td.principal) + (how.keepInterest ? 0n : net);
  const tdGl = await accountIdFor(tdAccount.product.depositGlKey, tx);
  const memberId = tdAccount.account.memberId;
  const lines: LineInput[] = [];
  if (!how.keepPrincipal) lines.push({ accountId: tdGl, debit: td.principal, memberId, memo: td.certificateNo });
  if (how.interest > 0n) lines.push({ accountId: await accountIdFor(tdAccount.product.interestGlKey, tx), debit: how.interest, memo: td.certificateNo });
  if (how.keepInterest && net > 0n) lines.push({ accountId: tdGl, credit: net, memberId, memo: `${td.certificateNo} interest added` });
  if (toSavings > 0n) lines.push({ accountId: await accountIdFor(savings.product.depositGlKey, tx), credit: toSavings, memberId, memo: savings.account.accountNo });
  if (wtax > 0n) lines.push({ accountId: await accountIdFor(tdAccount.product.wtaxGlKey, tx), credit: wtax });
  const verb = { MATURED: "matured", PRETERMINATED: "pre-terminated", ROLLED_OVER: "rolled over" }[how.status];
  let jeId: string | null = null;
  let jeNo: string | null = null;
  if (lines.length > 0) {
    const je = await postJournal(
      tx,
      {
        date,
        book: "GJ",
        particulars: `Time deposit ${verb} · ${td.certificateNo} · ${how.days} days at ${how.rate} · interest ${format(how.interest)}`,
        reference: td.certificateNo,
        source: { module: "savings-td", id: tdAccount.account.id },
        lines,
      },
      actorId,
    );
    jeId = je.id;
    jeNo = je.jeNo;
  }
  if (jeId) {
    if (how.interest > 0n) await post(tx, { accountId: tdAccount.account.id, type: "INTEREST", amount: how.interest, date, jeId, refNo: td.certificateNo, remarks: `${how.days} days at ${how.rate}` }, actorId);
    if (wtax > 0n) await post(tx, { accountId: tdAccount.account.id, type: "WTAX", amount: -wtax, date, jeId, refNo: td.certificateNo }, actorId);
    if (toSavings > 0n) {
      await post(tx, { accountId: tdAccount.account.id, type: "TRANSFER_OUT", amount: -toSavings, date, jeId, refNo: td.certificateNo, remarks: `To ${savings.account.accountNo}` }, actorId);
      await post(tx, { accountId: savings.account.id, type: "TRANSFER_IN", amount: toSavings, date, jeId, refNo: td.certificateNo, remarks: `Time deposit ${td.certificateNo} ${verb}` }, actorId);
    }
  }
  await tx.update(timeDeposits).set({ status: how.status, interestPaid: how.interest, closedAt: date, closeJeId: jeId }).where(eq(timeDeposits.id, td.id));
  if (!how.keepPrincipal) await tx.update(depositAccounts).set({ status: "CLOSED", closedAt: date }).where(eq(depositAccounts.id, tdAccount.account.id));
  await audit(tx, { action: `savings.td_${how.status.toLowerCase()}`, entity: "time_deposit", entityId: td.id, after: { interest: format(how.interest), wtax: format(wtax), days: how.days, rate: how.rate, jeNo }, userId: actorId });
  return { interest: how.interest, wtax, net, jeId };
}

/** At or after maturity: interest = principal × rate × term ÷ 365; principal and interest go to savings. */
export async function matureTimeDeposit(tx: Tx, input: { timeDepositId: string }, actorId: string) {
  const locked = await lockTd(tx, input.timeDepositId);
  const { td } = locked;
  if (td.status !== "ACTIVE") throw new SavingsError(`${td.certificateNo} is already ${td.status.toLowerCase().replace("_", " ")}`);
  if (businessToday() < td.maturityDate) throw new SavingsError(`${td.certificateNo} matures on ${formatDate(td.maturityDate)}; to end it earlier, pre-terminate it`);
  const interest = simpleInterest(td.principal, td.ratePa, td.termDays);
  return endTimeDeposit(tx, locked, { status: "MATURED", interest, days: td.termDays, rate: td.ratePa, keepPrincipal: false, keepInterest: false }, actorId);
}

/**
 * Before maturity: interest at the regular savings rate for the days held (td.pretermination_rate,
 * DOMAIN §2); principal and interest go to savings.
 */
export async function preterminateTimeDeposit(tx: Tx, input: { timeDepositId: string }, actorId: string) {
  const locked = await lockTd(tx, input.timeDepositId);
  const { td } = locked;
  if (td.status !== "ACTIVE") throw new SavingsError(`${td.certificateNo} is already ${td.status.toLowerCase().replace("_", " ")}`);
  const today = businessToday();
  if (today >= td.maturityDate) throw new SavingsError(`${td.certificateNo} has matured; mature it instead`);
  const regular = await productByCode("SAV", tx);
  if (!regular) throw new SavingsError("The Regular Savings product is missing");
  const days = daysBetween(td.placementDate, today);
  const interest = simpleInterest(td.principal, regular.ratePa, days);
  return endTimeDeposit(tx, locked, { status: "PRETERMINATED", interest, days, rate: regular.ratePa, keepPrincipal: false, keepInterest: false }, actorId);
}

/**
 * At or after maturity: the certificate matures and a new one is placed on the same TD account at
 * the product's current rate, with the principal (and the interest too when `withInterest`; otherwise
 * the interest goes to savings).
 */
export async function rolloverTimeDeposit(tx: Tx, input: { timeDepositId: string; withInterest: boolean; termDays: number }, actorId: string) {
  const locked = await lockTd(tx, input.timeDepositId);
  const { td, tdAccount } = locked;
  if (td.status !== "ACTIVE") throw new SavingsError(`${td.certificateNo} is already ${td.status.toLowerCase().replace("_", " ")}`);
  if (businessToday() < td.maturityDate) throw new SavingsError(`${td.certificateNo} matures on ${formatDate(td.maturityDate)}; it can be rolled over from then`);
  if (!Number.isInteger(input.termDays) || input.termDays < 1 || input.termDays > 3650) throw new SavingsError("Enter the term in days (1 to 3,650)");
  if (!tdAccount.product.active) throw new SavingsError(`${tdAccount.product.name} is no longer offered`);
  const interest = simpleInterest(td.principal, td.ratePa, td.termDays);
  const ended = await endTimeDeposit(tx, locked, { status: "ROLLED_OVER", interest, days: td.termDays, rate: td.ratePa, keepPrincipal: true, keepInterest: input.withInterest }, actorId);
  const principal = td.principal + (input.withInterest ? ended.net : 0n);
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(timeDeposits).where(eq(timeDeposits.accountId, tdAccount.account.id))) as [{ n: number }];
  const date = businessToday();
  const certificateNo = `${tdAccount.account.accountNo}-${n + 1}`;
  const [next] = await tx
    .insert(timeDeposits)
    .values({
      accountId: tdAccount.account.id,
      certificateNo,
      principal,
      ratePa: tdAccount.product.ratePa,
      termDays: input.termDays,
      placementDate: date,
      maturityDate: addDays(date, input.termDays),
      savingsAccountId: td.savingsAccountId,
      rolledFromId: td.id,
      jeId: ended.jeId ?? td.jeId,
      createdBy: actorId,
    })
    .returning();
  if (!next) throw new Error("time deposit insert returned no row");
  await audit(tx, { action: "savings.td_place", entity: "time_deposit", entityId: next.id, after: { certificateNo, principal: format(principal), termDays: input.termDays, rolledFrom: td.certificateNo }, userId: actorId });
  return { timeDepositId: next.id, certificateNo, interest: ended.interest, principal };
}

/** Time deposits, active first by maturity (Time deposits page). */
export async function timeDepositRegistry(filters: { status?: TimeDeposit["status"] }, db: Db | Tx = getDb()) {
  return db
    .select({ td: timeDeposits, accountNo: depositAccounts.accountNo, memberId: members.id, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName })
    .from(timeDeposits)
    .innerJoin(depositAccounts, eq(depositAccounts.id, timeDeposits.accountId))
    .innerJoin(members, eq(members.id, depositAccounts.memberId))
    .where(filters.status ? eq(timeDeposits.status, filters.status) : undefined)
    .orderBy(sql`${timeDeposits.status} <> 'ACTIVE'`, asc(timeDeposits.maturityDate))
    .limit(500);
}

// ── Dormancy (T9.5) ──

/**
 * Marks OPEN savings accounts DORMANT when the member made no deposit or withdrawal for the
 * product's dormant_after_months (counting from the opening if there was none).
 */
export async function markDormant(tx: Tx, date: BusinessDate, actorId: string | null = null): Promise<{ dormant: number }> {
  const products = await tx.select().from(depositProducts).where(eq(depositProducts.kind, "SAVINGS"));
  let dormant = 0;
  for (const p of products) {
    if (!p.dormantAfterMonths) continue;
    const cutoff = addMonths(date, -p.dormantAfterMonths);
    const marked = await tx
      .update(depositAccounts)
      .set({ status: "DORMANT" })
      .where(and(eq(depositAccounts.productId, p.id), eq(depositAccounts.status, "OPEN"), sql`coalesce(${depositAccounts.lastCustomerTxnAt}, ${depositAccounts.openedAt}) <= ${cutoff}`))
      .returning({ id: depositAccounts.id, accountNo: depositAccounts.accountNo });
    for (const a of marked) await audit(tx, { action: "savings.dormant", entity: "deposit_account", entityId: a.id, after: { accountNo: a.accountNo, date }, userId: actorId });
    dormant += marked.length;
  }
  return { dormant };
}

registerTerminationRule({
  name: "deposits",
  check: async (memberId, db) => {
    const open = await db
      .select({ accountNo: depositAccounts.accountNo })
      .from(depositAccounts)
      .where(and(eq(depositAccounts.memberId, memberId), ne(depositAccounts.status, "CLOSED")))
      .orderBy(asc(depositAccounts.accountNo));
    if (open.length === 0) return null;
    return `all deposit accounts must be closed (zero balance) first (${open.map((a) => a.accountNo).join(", ")})`;
  },
});
