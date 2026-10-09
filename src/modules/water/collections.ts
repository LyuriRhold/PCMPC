import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addDays, businessToday, now, type BusinessDate } from "@/lib/dates";
import { format, mulRate, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { receiptItems, receipts } from "@/modules/cashiering/schema";
import { createDv } from "@/modules/cashiering/service";
import { journalEntries } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import {
  waterAccountHistory,
  waterAccounts,
  waterBillAdjustments,
  waterBillingPeriods,
  waterBills,
  waterCustomers,
  waterDepositSettlements,
  waterDisconnections,
  waterFees,
  waterPaymentAllocations,
  waterPenalties,
  type BillStatus,
  type WaterAccount,
  type WaterCustomer,
} from "./schema";
import { customerName, WaterError } from "./service";

/**
 * Water collections (PHASE-07): what each bill still owes, how payments are allocated (oldest
 * bill first; within a bill the penalty first), penalties, the disconnection cycle and the deposit
 * settlement on closure. Allocations, penalties and settlements are never changed; a cancelled
 * receipt's allocations simply stop counting.
 */

// ── Balances ──

export type BillBalance = {
  billId: string;
  billNo: string;
  accountId: string;
  customerId: string;
  period: string;
  billDate: BusinessDate;
  dueDate: BusinessDate;
  status: BillStatus;
  /** current − advance applied + approved debit memos − approved credit memos */
  billAmount: Money;
  billPaid: Money;
  penalty: Money;
  penaltyPaid: Money;
  billDue: Money;
  penaltyDue: Money;
  outstanding: Money;
};

export type BalanceFilter = {
  accountIds?: string[];
  customerIds?: string[];
  billIds?: string[];
  /** Count only bills, memos, penalties and payments dated on or before this date. */
  asOf?: BusinessDate;
  /** Leave this receipt out (it is being cancelled). */
  excludeReceiptId?: string;
};

const sum = (xs: Money[]) => xs.reduce((s, x) => s + x, 0n);

export async function billBalances(db: Db | Tx, f: BalanceFilter): Promise<BillBalance[]> {
  const conds = [sql`${waterBills.status} <> 'CANCELLED'`];
  if (f.accountIds) conds.push(f.accountIds.length ? inArray(waterBills.accountId, f.accountIds) : sql`false`);
  if (f.customerIds) conds.push(f.customerIds.length ? inArray(waterBills.customerId, f.customerIds) : sql`false`);
  if (f.billIds) conds.push(f.billIds.length ? inArray(waterBills.id, f.billIds) : sql`false`);
  if (f.asOf) conds.push(lte(waterBills.billDate, f.asOf));
  const bills = await db
    .select({ bill: waterBills, period: waterBillingPeriods.period })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(and(...conds))
    .orderBy(asc(waterBillingPeriods.period), asc(waterBills.billNo));
  if (bills.length === 0) return [];
  const ids = bills.map((b) => b.bill.id);

  const memos = await db
    .select({ billId: waterBillAdjustments.billId, kind: waterBillAdjustments.kind, amount: waterBillAdjustments.amount, date: journalEntries.entryDate })
    .from(waterBillAdjustments)
    .innerJoin(journalEntries, eq(journalEntries.id, waterBillAdjustments.jeId))
    .where(and(inArray(waterBillAdjustments.billId, ids), eq(waterBillAdjustments.status, "APPROVED")));
  const penalties = await db.select().from(waterPenalties).where(inArray(waterPenalties.billId, ids));
  const allocations = await db
    .select({ a: waterPaymentAllocations, receiptId: receipts.id, receiptStatus: receipts.status, receiptDate: receipts.receiptDate, settledOn: journalEntries.entryDate })
    .from(waterPaymentAllocations)
    .leftJoin(receiptItems, eq(receiptItems.id, waterPaymentAllocations.receiptItemId))
    .leftJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .leftJoin(waterDepositSettlements, eq(waterDepositSettlements.id, waterPaymentAllocations.settlementId))
    .leftJoin(journalEntries, eq(journalEntries.id, waterDepositSettlements.offsetJeId))
    .where(inArray(waterPaymentAllocations.billId, ids));

  const counts = (date: BusinessDate | null) => !f.asOf || (date !== null && date <= f.asOf);
  return bills.map(({ bill, period }) => {
    const m = memos.filter((x) => x.billId === bill.id && counts(x.date));
    const billAmount = bill.currentAmount - bill.advanceApplied + sum(m.filter((x) => x.kind === "DEBIT").map((x) => x.amount)) - sum(m.filter((x) => x.kind === "CREDIT").map((x) => x.amount));
    const penalty = sum(penalties.filter((p) => p.billId === bill.id && counts(p.assessedOn)).map((p) => p.amount));
    const paid = allocations.filter((x) => {
      if (x.a.billId !== bill.id) return false;
      if (x.a.receiptItemId) return x.receiptStatus === "VALID" && x.receiptId !== f.excludeReceiptId && counts(x.receiptDate);
      return counts(x.settledOn);
    });
    const billPaid = sum(paid.map((x) => x.a.billPart));
    const penaltyPaid = sum(paid.map((x) => x.a.penaltyPart));
    const billDue = billAmount - billPaid > 0n ? billAmount - billPaid : 0n;
    const penaltyDue = penalty - penaltyPaid > 0n ? penalty - penaltyPaid : 0n;
    return {
      billId: bill.id,
      billNo: bill.billNo,
      accountId: bill.accountId,
      customerId: bill.customerId,
      period,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      status: bill.status,
      billAmount,
      billPaid,
      penalty,
      penaltyPaid,
      billDue,
      penaltyDue,
      outstanding: billDue + penaltyDue,
    };
  });
}

/** Everything an account still owes (bills + penalties). */
export async function accountOutstanding(accountId: string, db: Db | Tx = getDb()): Promise<Money> {
  return sum((await billBalances(db, { accountIds: [accountId] })).map((b) => b.outstanding));
}

/** Sets each bill's status from what it still owes (UNPAID / PARTIAL / PAID). */
export async function refreshBillStatuses(tx: Tx, billIds: string[], excludeReceiptId?: string): Promise<void> {
  if (billIds.length === 0) return;
  for (const b of await billBalances(tx, { billIds, excludeReceiptId })) {
    const status: BillStatus = b.outstanding === 0n ? "PAID" : b.billPaid + b.penaltyPaid > 0n ? "PARTIAL" : "UNPAID";
    if (status !== b.status) await tx.update(waterBills).set({ status }).where(eq(waterBills.id, b.billId));
  }
}

// ── Allocation ──

export type Allocation = { billId: string; penaltyPart: Money; billPart: Money };

/** Oldest bill first; within a bill the penalty first, then the bill. Returns the parts and what's left over. */
export function allocate(amount: Money, open: BillBalance[]): { allocations: Allocation[]; leftover: Money } {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const b of open) {
    if (left <= 0n) break;
    const penaltyPart = b.penaltyDue < left ? b.penaltyDue : left;
    left -= penaltyPart;
    const billPart = b.billDue < left ? b.billDue : left;
    left -= billPart;
    if (penaltyPart + billPart > 0n) allocations.push({ billId: b.billId, penaltyPart, billPart });
  }
  return { allocations, leftover: left };
}

/** Bills of an account with something still owed, oldest first, net of allocations not yet written. */
export async function openBills(tx: Db | Tx, accountId: string, pending: Allocation[] = []): Promise<BillBalance[]> {
  return (await billBalances(tx, { accountIds: [accountId] }))
    .map((b) => {
      const p = pending.filter((x) => x.billId === b.billId);
      const penaltyDue = b.penaltyDue - sum(p.map((x) => x.penaltyPart));
      const billDue = b.billDue - sum(p.map((x) => x.billPart));
      return { ...b, penaltyDue, billDue, outstanding: penaltyDue + billDue };
    })
    .filter((b) => b.outstanding > 0n);
}

// ── Penalties (daily job) ──

/**
 * Assesses the late-payment penalty (water.penalty_pct × the bill's unpaid amount on its due date)
 * on every bill past due on `date` that has none yet: one entry Dr AR–Water (per customer) /
 * Cr Penalty Income–Water. Unique (bill_id) keeps it to once per bill.
 */
export async function assessPenalties(tx: Tx, date: BusinessDate): Promise<{ penalties: number; total: string }> {
  const pct = await getSetting("water.penalty_pct", tx);
  const candidates = await tx
    .select({ id: waterBills.id, dueDate: waterBills.dueDate })
    .from(waterBills)
    .leftJoin(waterPenalties, eq(waterPenalties.billId, waterBills.id))
    .where(and(sql`${waterBills.dueDate} < ${date}`, sql`${waterBills.status} <> 'CANCELLED'`, sql`${waterPenalties.id} IS NULL`));
  const due: Array<{ billId: string; customerId: string; billNo: string; amount: Money }> = [];
  for (const c of candidates) {
    const [b] = await billBalances(tx, { billIds: [c.id], asOf: c.dueDate });
    if (!b || b.billDue <= 0n) continue;
    const amount = mulRate(b.billDue, pct, "HALF_UP");
    if (amount > 0n) due.push({ billId: b.billId, customerId: b.customerId, billNo: b.billNo, amount });
  }
  if (due.length === 0) return { penalties: 0, total: "0" };
  const [ar, income] = await Promise.all([accountIdFor("ar_water", tx), accountIdFor("penalty_income_water", tx)]);
  const total = sum(due.map((d) => d.amount));
  const je = await postJournal(
    tx,
    {
      date,
      book: "GJ",
      particulars: `Water late-payment penalties assessed ${date}`,
      reference: `penalties:${date}`,
      source: { module: "water-penalties" },
      lines: [...due.map((d): LineInput => ({ accountId: ar, debit: d.amount, customerId: d.customerId, memo: d.billNo })), { accountId: income, credit: total }],
    },
    null,
  );
  await tx.insert(waterPenalties).values(due.map((d) => ({ billId: d.billId, assessedOn: date, amount: d.amount, jeId: je.id })));
  await refreshBillStatuses(tx, due.map((d) => d.billId));
  await audit(tx, { action: "water.penalties_assess", entity: "journal_entry", entityId: je.id, after: { date, bills: due.length, total: format(total) }, userId: null });
  return { penalties: due.length, total: String(total) };
}

// ── Disconnection cycle ──

export type ListedAccount = {
  accountId: string;
  accountNo: string;
  customerId: string;
  customerName: string;
  serviceAddress: string;
  unpaidBills: number;
  outstanding: Money;
  notice: { id: string; noticeNo: string; scheduledDate: BusinessDate; status: string } | null;
};

/** ACTIVE accounts with at least water.disconnect_after_bills unpaid bills, with any open notice. */
export async function disconnectionList(db: Db | Tx = getDb()): Promise<ListedAccount[]> {
  const min = await getSetting("water.disconnect_after_bills", db);
  const accounts = await db
    .select({ account: waterAccounts, customer: waterCustomers })
    .from(waterAccounts)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .where(eq(waterAccounts.status, "ACTIVE"))
    .orderBy(asc(waterAccounts.accountNo));
  if (accounts.length === 0) return [];
  const balances = await billBalances(db, { accountIds: accounts.map((a) => a.account.id) });
  const notices = await db.select().from(waterDisconnections).where(and(inArray(waterDisconnections.accountId, accounts.map((a) => a.account.id)), eq(waterDisconnections.status, "NOTICED")));
  const out: ListedAccount[] = [];
  for (const { account, customer } of accounts) {
    const unpaid = balances.filter((b) => b.accountId === account.id && b.outstanding > 0n);
    if (unpaid.length < min) continue;
    const n = notices.find((x) => x.accountId === account.id);
    out.push({
      accountId: account.id,
      accountNo: account.accountNo,
      customerId: customer.id,
      customerName: customerName(customer),
      serviceAddress: account.serviceAddress,
      unpaidBills: unpaid.length,
      outstanding: sum(unpaid.map((b) => b.outstanding)),
      notice: n ? { id: n.id, noticeNo: n.noticeNo, scheduledDate: n.scheduledDate, status: n.status } : null,
    });
  }
  return out;
}

async function lockAccount(tx: Tx, accountId: string): Promise<WaterAccount> {
  const [a] = await tx.select().from(waterAccounts).where(eq(waterAccounts.id, accountId)).for("update");
  if (!a) throw new WaterError("Account not found");
  return a;
}

async function history(tx: Tx, accountId: string, event: string, fromValue: string | null, toValue: string | null, ref: string | null, actorId: string) {
  await tx.insert(waterAccountHistory).values({ accountId, event, fromValue, toValue, ref, at: now(), by: actorId, createdBy: actorId });
}

/** Issues a disconnection notice: the account must be on the list; disconnection is allowed after water.notice_days. */
export async function issueNotice(tx: Tx, accountId: string, actorId: string) {
  const a = await lockAccount(tx, accountId);
  if (a.status !== "ACTIVE") throw new WaterError(`${a.accountNo} is ${a.status}`);
  const [open] = await tx.select().from(waterDisconnections).where(and(eq(waterDisconnections.accountId, a.id), inArray(waterDisconnections.status, ["NOTICED", "DISCONNECTED"])));
  if (open) throw new WaterError(`${a.accountNo} already has notice ${open.noticeNo}`);
  const min = await getSetting("water.disconnect_after_bills", tx);
  const unpaid = (await billBalances(tx, { accountIds: [a.id] })).filter((b) => b.outstanding > 0n);
  if (unpaid.length < min) throw new WaterError(`${a.accountNo} has ${unpaid.length} unpaid bill${unpaid.length === 1 ? "" : "s"}; a notice needs ${min}`);
  const today = businessToday();
  const noticeNo = await nextNumber("DN", tx, today);
  const [row] = await tx
    .insert(waterDisconnections)
    .values({
      accountId: a.id,
      noticeNo,
      noticeDate: today,
      scheduledDate: addDays(today, await getSetting("water.notice_days", tx)),
      noticeAmount: sum(unpaid.map((b) => b.outstanding)),
      noticeBills: unpaid.length,
      by: actorId,
      createdBy: actorId,
    })
    .returning();
  if (!row) throw new Error("notice insert returned no row");
  await history(tx, a.id, "DISCONNECTION_NOTICE", null, noticeNo, format(row.noticeAmount), actorId);
  await audit(tx, { action: "water.notice_issue", entity: "water_disconnection", entityId: row.id, after: { accountNo: a.accountNo, noticeNo, scheduledDate: row.scheduledDate, amount: format(row.noticeAmount) }, userId: actorId });
  return row;
}

async function lockDisconnection(tx: Tx, id: string) {
  const [d] = await tx.select().from(waterDisconnections).where(eq(waterDisconnections.id, id)).for("update");
  if (!d) throw new WaterError("Disconnection notice not found");
  return d;
}

function assertReading(reading: number) {
  if (!Number.isInteger(reading) || reading < 0) throw new WaterError("The reading must be a whole number of 0 or more");
}

/** Records the field disconnection (with the meter reading) once the notice period is over. */
export async function disconnect(tx: Tx, input: { disconnectionId: string; reading: number }, actorId: string) {
  const d = await lockDisconnection(tx, input.disconnectionId);
  if (d.status !== "NOTICED") throw new WaterError(`Notice ${d.noticeNo} is ${d.status}`);
  const today = businessToday();
  if (today < d.scheduledDate) throw new WaterError(`Notice ${d.noticeNo} gives the customer until ${d.scheduledDate}; disconnect after that`);
  assertReading(input.reading);
  const a = await lockAccount(tx, d.accountId);
  if ((await accountOutstanding(a.id, tx)) === 0n) throw new WaterError(`${a.accountNo} has paid everything; cancel notice ${d.noticeNo}`);
  await tx.update(waterDisconnections).set({ status: "DISCONNECTED", disconnectedAt: today, disconnectReading: input.reading, disconnectedBy: actorId }).where(eq(waterDisconnections.id, d.id));
  await tx.update(waterAccounts).set({ status: "DISCONNECTED", updatedAt: now() }).where(eq(waterAccounts.id, a.id));
  await history(tx, a.id, "STATUS", a.status, "DISCONNECTED", `${d.noticeNo} · reading ${input.reading}`, actorId);
  await audit(tx, { action: "water.disconnect", entity: "water_disconnection", entityId: d.id, after: { accountNo: a.accountNo, reading: input.reading }, userId: actorId });
}

/** The reconnection-fee receipt item paid by the customer since the disconnection and not used yet. */
async function unusedReconnectionFee(tx: Tx, customerId: string, since: BusinessDate): Promise<string | null> {
  const rows = await tx
    .select({ id: receiptItems.id })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .leftJoin(waterDisconnections, eq(waterDisconnections.feeReceiptItemId, receiptItems.id))
    .where(
      and(
        eq(receiptItems.type, "WATER_OTHER_FEE"),
        eq(receiptItems.refId, "RECONNECTION"),
        eq(receipts.status, "VALID"),
        eq(receipts.payorType, "WATER_CUSTOMER"),
        eq(receipts.payorId, customerId),
        sql`${receipts.receiptDate} >= ${since}`,
        sql`${waterDisconnections.id} IS NULL`,
      ),
    )
    .orderBy(asc(receipts.receiptDate))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Reconnects once all arrears and penalties and the reconnection fee are paid. */
export async function reconnect(tx: Tx, input: { disconnectionId: string; reading: number }, actorId: string) {
  const d = await lockDisconnection(tx, input.disconnectionId);
  if (d.status !== "DISCONNECTED") throw new WaterError(`Notice ${d.noticeNo} is ${d.status}`);
  assertReading(input.reading);
  const a = await lockAccount(tx, d.accountId);
  const owed = await accountOutstanding(a.id, tx);
  if (owed > 0n) throw new WaterError(`Pay all arrears and penalties first: ${format(owed)} is unpaid on ${a.accountNo}`);
  const fee = await unusedReconnectionFee(tx, a.customerId, d.disconnectedAt ?? d.noticeDate);
  if (!fee) {
    const [f] = await tx.select().from(waterFees).where(eq(waterFees.code, "RECONNECTION"));
    throw new WaterError(`Collect the reconnection fee${f ? ` (${format(f.amount)})` : ""} at the teller first`);
  }
  const today = businessToday();
  await tx.update(waterDisconnections).set({ status: "RECONNECTED", reconnectedAt: today, reconnectReading: input.reading, reconnectedBy: actorId, feeReceiptItemId: fee }).where(eq(waterDisconnections.id, d.id));
  await tx.update(waterAccounts).set({ status: "ACTIVE", updatedAt: now() }).where(eq(waterAccounts.id, a.id));
  await history(tx, a.id, "STATUS", "DISCONNECTED", "ACTIVE", `${d.noticeNo} · reading ${input.reading}`, actorId);
  await audit(tx, { action: "water.reconnect", entity: "water_disconnection", entityId: d.id, after: { accountNo: a.accountNo, reading: input.reading }, userId: actorId });
}

/** Cancels a notice that hasn't led to a disconnection (e.g. the customer paid). */
export async function cancelNotice(tx: Tx, disconnectionId: string, reason: string, actorId: string) {
  const d = await lockDisconnection(tx, disconnectionId);
  if (d.status !== "NOTICED") throw new WaterError(`Notice ${d.noticeNo} is ${d.status}`);
  if (!reason.trim()) throw new WaterError("A reason is required");
  await tx.update(waterDisconnections).set({ status: "CANCELLED", cancelReason: reason.trim() }).where(eq(waterDisconnections.id, d.id));
  await audit(tx, { action: "water.notice_cancel", entity: "water_disconnection", entityId: d.id, after: { noticeNo: d.noticeNo, reason: reason.trim() }, userId: actorId });
}

// ── Deposit settlement on closure ──

export type Settlement = { deposit: Money; unpaid: Money; offset: Money; refund: Money; offsetJeId: string | null; dvId: string | null };

/**
 * Settles a closed account's meter deposit: it offsets what the account still owes
 * (Dr Customers' Deposits / Cr AR–Water, allocated oldest bill first) and the rest is refunded by a
 * DV (DRAFT, Dr Customers' Deposits / Cr Cash when released).
 */
export async function settleDeposit(tx: Tx, account: WaterAccount, customer: WaterCustomer, actorId: string): Promise<Settlement | null> {
  const [a] = await tx.select().from(waterAccounts).where(eq(waterAccounts.id, account.id)).for("update");
  if (!a) throw new WaterError("Account not found");
  const deposit = a.depositAmount;
  if (deposit <= 0n) return null;
  const open = await openBills(tx, a.id);
  const unpaid = sum(open.map((b) => b.outstanding));
  const offset = deposit < unpaid ? deposit : unpaid;
  const refund = deposit - offset;
  const today = businessToday();
  const depositsAcct = await accountIdFor("customers_deposits", tx);

  let offsetJeId: string | null = null;
  if (offset > 0n) {
    const je = await postJournal(
      tx,
      {
        date: today,
        book: "GJ",
        particulars: `Meter deposit applied to unpaid bills · ${a.accountNo}`,
        reference: a.accountNo,
        source: { module: "water-settlement", id: a.id },
        lines: [
          { accountId: depositsAcct, debit: offset, customerId: customer.id, memo: a.accountNo },
          { accountId: await accountIdFor("ar_water", tx), credit: offset, customerId: customer.id, memo: a.accountNo },
        ],
      },
      actorId,
    );
    offsetJeId = je.id;
  }
  let dvId: string | null = null;
  if (refund > 0n) {
    const dv = await createDv(
      tx,
      {
        date: today,
        payee: customerName(customer),
        particulars: `Meter deposit refund · ${a.accountNo} (deposit ${format(deposit)} less unpaid ${format(offset)})`,
        mode: "CASH",
        checkNo: null,
        lines: [{ accountId: depositsAcct, memberId: null, customerId: customer.id, amount: refund, memo: a.accountNo }],
      },
      actorId,
    );
    dvId = dv.id;
  }
  const [s] = await tx.insert(waterDepositSettlements).values({ accountId: a.id, deposit, unpaid, offset, refund, offsetJeId, dvId, createdBy: actorId }).returning();
  if (!s) throw new Error("settlement insert returned no row");
  if (offset > 0n) {
    const { allocations } = allocate(offset, open);
    await tx.insert(waterPaymentAllocations).values(allocations.map((x) => ({ ...x, settlementId: s.id, createdBy: actorId })));
    await refreshBillStatuses(tx, allocations.map((x) => x.billId));
  }
  await tx.update(waterAccounts).set({ depositAmount: 0n, updatedAt: now() }).where(eq(waterAccounts.id, a.id));
  await history(tx, a.id, "DEPOSIT_SETTLED", format(deposit), format(refund), offset > 0n ? `offset ${format(offset)}` : null, actorId);
  await audit(tx, { action: "water.deposit_settle", entity: "water_account", entityId: a.id, after: { deposit: format(deposit), unpaid: format(unpaid), offset: format(offset), refund: format(refund), dvId }, userId: actorId });
  return { deposit, unpaid, offset, refund, offsetJeId, dvId };
}


/** What a printed disconnection notice shows (the bills still unpaid now). */
export async function noticeData(disconnectionId: string, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ d: waterDisconnections, account: waterAccounts, customer: waterCustomers })
    .from(waterDisconnections)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterDisconnections.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .where(eq(waterDisconnections.id, disconnectionId));
  if (!r) return null;
  const bills = (await billBalances(db, { accountIds: [r.account.id] })).filter((b) => b.outstanding > 0n);
  const [fee] = await db.select().from(waterFees).where(eq(waterFees.code, "RECONNECTION"));
  return {
    noticeNo: r.d.noticeNo,
    noticeDate: r.d.noticeDate,
    scheduledDate: r.d.scheduledDate,
    customerName: customerName(r.customer),
    accountNo: r.account.accountNo,
    serviceAddress: r.account.serviceAddress,
    bills: bills.map((b) => ({ billNo: b.billNo, period: b.period, dueDate: b.dueDate, outstanding: b.outstanding })),
    total: sum(bills.map((b) => b.outstanding)),
    reconnectionFee: fee?.amount ?? null,
  };
}

/** Notices still open (NOTICED) and accounts currently DISCONNECTED, oldest first. */
export async function openNotices(db: Db | Tx = getDb()) {
  const rows = await db
    .select({ d: waterDisconnections, accountNo: waterAccounts.accountNo, customer: waterCustomers })
    .from(waterDisconnections)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterDisconnections.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .where(inArray(waterDisconnections.status, ["NOTICED", "DISCONNECTED"]))
    .orderBy(asc(waterDisconnections.noticeDate), asc(waterDisconnections.noticeNo));
  return rows.map((r) => ({ ...r.d, accountNo: r.accountNo, customerName: customerName(r.customer) }));
}
