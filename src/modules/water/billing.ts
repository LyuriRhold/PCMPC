import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { businessToday, now, type BusinessDate } from "@/lib/dates";
import { runOnce } from "@/lib/jobs";
import { format, mulRate, type Money } from "@/lib/money";
import { next as nextNumber } from "@/lib/numbering";
import { journalLines } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import { computeWaterCharge } from "./rates";
import { enterReading, lockPeriod, periodLabel, zoneAccounts } from "./readings";
import {
  waterAccountHistory,
  waterAccounts,
  waterBillAdjustments,
  waterBillingExclusions,
  waterBillingPeriods,
  waterBillLines,
  waterBills,
  waterCustomers,
  waterMeterInstallations,
  waterMeters,
  waterReadings,
  waterRoutes,
  waterZones,
  type AdjustmentKind,
  type BillingPeriod,
  type BillLineKind,
  type WaterAccount,
  type WaterBill,
  type WaterCustomer,
  type WaterReading,
} from "./schema";
import { isSeniorEligible, WaterError } from "./service";

/**
 * Billing engine (PHASE-06 T6.5), credit/debit memos (T6.7) and final bills (T6.8).
 * One journal entry per billing run: Dr AR–Water (customer-tagged, net of discount) + Dr Senior
 * Citizen Discounts / Cr Water Revenue–Members and –Non-members; advances applied in the same
 * entry as Dr Customers' Advances / Cr AR–Water.
 */

export type DraftLine = { kind: BillLineKind; description: string; qty: number | null; rate: Money | null; amount: Money };

export type DraftBill = {
  account: WaterAccount;
  customer: WaterCustomer;
  reading: WaterReading;
  consumption: number;
  basicCharge: Money;
  seniorDiscount: Money;
  otherCharges: Money;
  advanceApplied: Money;
  currentAmount: Money;
  previousBalance: Money;
  totalAmountDue: Money;
  lines: DraftLine[];
};

export type Blocker = { accountId: string; accountNo: string; problem: string };

// ── Balances ──

/**
 * Unpaid balance of an account's bills before `period` (YYYY-MM): bills net of advances,
 * plus approved debit memos, minus approved credit memos. Payments arrive in Phase 07.
 */
export async function previousBalance(db: Db | Tx, accountId: string, period: string): Promise<Money> {
  const bills = await db
    .select({ id: waterBills.id, current: waterBills.currentAmount, advance: waterBills.advanceApplied })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(and(eq(waterBills.accountId, accountId), lt(waterBillingPeriods.period, period), sql`${waterBills.status} <> 'CANCELLED'`));
  if (bills.length === 0) return 0n;
  const memos = await db
    .select({ kind: waterBillAdjustments.kind, amount: waterBillAdjustments.amount })
    .from(waterBillAdjustments)
    .where(and(inArray(waterBillAdjustments.billId, bills.map((b) => b.id)), eq(waterBillAdjustments.status, "APPROVED")));
  const total = bills.reduce((s, b) => s + b.current - b.advance, 0n) + memos.reduce((s, m) => s + (m.kind === "DEBIT" ? m.amount : -m.amount), 0n);
  return total > 0n ? total : 0n;
}

/** A customer's unapplied advance credits (Customers' Advances sub-ledger). */
export async function advanceBalance(db: Db | Tx, customerId: string): Promise<Money> {
  const adv = await accountIdFor("customers_advances", db);
  const [r] = await db
    .select({ net: sql<string>`COALESCE(SUM(${journalLines.credit} - ${journalLines.debit}), 0)` })
    .from(journalLines)
    .where(and(eq(journalLines.accountId, adv), eq(journalLines.customerId, customerId)));
  const net = BigInt(r?.net ?? "0");
  return net > 0n ? net : 0n;
}

// ── Computing bills ──

/** Prices one reading: tariff in force on `rateDate`, senior discount on `billDate`, advances, previous balance. */
async function draftBill(
  db: Db | Tx,
  input: { account: WaterAccount; customer: WaterCustomer; reading: WaterReading; period: string; rateDate: BusinessDate; billDate: BusinessDate; advanceAvailable: Money },
): Promise<DraftBill> {
  const { account, reading } = input;
  const charge = await computeWaterCharge(account.classification, reading.consumption, input.rateDate, db);
  const lines: DraftLine[] = charge.lines.map((l, i) => ({
    kind: i === 0 ? ("MIN_CHARGE" as const) : ("BLOCK" as const),
    description: l.label,
    qty: l.m3,
    rate: l.rate,
    amount: l.amount,
  }));
  const basicCharge = charge.total;

  let seniorDiscount = 0n;
  const senior = await getSetting("water.senior_discount", db);
  if (account.classification === "RESIDENTIAL" && reading.consumption <= senior.maxM3 && (await isSeniorEligible(account.id, input.billDate, db))) {
    seniorDiscount = mulRate(basicCharge, senior.rate, "HALF_UP");
    if (seniorDiscount > 0n) lines.push({ kind: "SENIOR_DISCOUNT", description: `Senior-citizen discount (${Number(senior.rate) * 100}% of basic charge)`, qty: null, rate: null, amount: -seniorDiscount });
  }
  const otherCharges = 0n;
  const currentAmount = basicCharge - seniorDiscount + otherCharges;
  const advanceApplied = input.advanceAvailable < currentAmount ? input.advanceAvailable : currentAmount;
  if (advanceApplied > 0n) lines.push({ kind: "ADVANCE_APPLIED", description: "Advance payment applied", qty: null, rate: null, amount: -advanceApplied });
  const prev = await previousBalance(db, account.id, input.period);
  return {
    account,
    customer: input.customer,
    reading,
    consumption: reading.consumption,
    basicCharge,
    seniorDiscount,
    otherCharges,
    advanceApplied,
    currentAmount,
    previousBalance: prev,
    totalAmountDue: currentAmount - advanceApplied + prev,
    lines,
  };
}

async function customersById(db: Db | Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, WaterCustomer>();
  const rows = await db.select().from(waterCustomers).where(inArray(waterCustomers.id, ids));
  return new Map(rows.map((c) => [c.id, c]));
}

/** What a billing run would produce, and what blocks it. Nothing is written. */
export async function computeRun(db: Db | Tx, period: BillingPeriod): Promise<{ bills: DraftBill[]; blockers: Blocker[] }> {
  const accounts = await zoneAccounts(db, period.zoneId);
  const readings = await db.select().from(waterReadings).where(eq(waterReadings.periodId, period.id));
  const excluded = new Set((await db.select({ accountId: waterBillingExclusions.accountId }).from(waterBillingExclusions).where(eq(waterBillingExclusions.periodId, period.id))).map((r) => r.accountId));
  const byAccount = new Map(readings.map((r) => [r.accountId, r]));
  const billed = new Set((await db.select({ accountId: waterBills.accountId }).from(waterBills).where(eq(waterBills.periodId, period.id))).map((r) => r.accountId));
  const customers = await customersById(db, [...new Set(accounts.map((a) => a.customerId))]);

  const blockers: Blocker[] = [];
  const bills: DraftBill[] = [];
  const advanceLeft = new Map<string, Money>();
  for (const account of accounts) {
    if (excluded.has(account.id) || billed.has(account.id)) continue;
    const r = byAccount.get(account.id);
    if (!r) {
      blockers.push({ accountId: account.id, accountNo: account.accountNo, problem: "no reading" });
      continue;
    }
    if (r.status === "ENTERED") {
      blockers.push({ accountId: account.id, accountNo: account.accountNo, problem: `awaiting approval (${r.flags.join(", ")})` });
      continue;
    }
    if (r.status === "REJECTED") {
      blockers.push({ accountId: account.id, accountNo: account.accountNo, problem: "reading rejected; re-read the meter" });
      continue;
    }
    const customer = customers.get(account.customerId);
    if (!customer) throw new Error(`customer of ${account.accountNo} not found`);
    if (!advanceLeft.has(customer.id)) advanceLeft.set(customer.id, await advanceBalance(db, customer.id));
    const draft = await draftBill(db, { account, customer, reading: r, period: period.period, rateDate: period.readingTo, billDate: period.billDate, advanceAvailable: advanceLeft.get(customer.id)! });
    advanceLeft.set(customer.id, advanceLeft.get(customer.id)! - draft.advanceApplied);
    bills.push(draft);
  }
  return { bills, blockers };
}

export async function previewRun(periodId: string, db: Db | Tx = getDb()) {
  const [period] = await db.select().from(waterBillingPeriods).where(eq(waterBillingPeriods.id, periodId));
  if (!period) throw new WaterError("Billing period not found");
  return { period, ...(await computeRun(db, period)) };
}

// ── Posting ──

async function journalLinesFor(tx: Tx, bills: DraftBill[]): Promise<LineInput[]> {
  const [ar, disc, revM, revN, adv] = await Promise.all(
    ["ar_water", "senior_citizen_discounts", "water_revenue_members", "water_revenue_nonmembers", "customers_advances"].map((k) => accountIdFor(k, tx)),
  );
  const lines: LineInput[] = [];
  let discount = 0n;
  let members = 0n;
  let nonMembers = 0n;
  for (const b of bills) {
    if (b.currentAmount > 0n) lines.push({ accountId: ar!, debit: b.currentAmount, customerId: b.customer.id, memo: b.account.accountNo });
    discount += b.seniorDiscount;
    const revenue = b.basicCharge + b.otherCharges;
    if (b.customer.type === "MEMBER") members += revenue;
    else nonMembers += revenue;
  }
  if (discount > 0n) lines.push({ accountId: disc!, debit: discount });
  if (members > 0n) lines.push({ accountId: revM!, credit: members });
  if (nonMembers > 0n) lines.push({ accountId: revN!, credit: nonMembers });
  for (const b of bills) {
    if (b.advanceApplied <= 0n) continue;
    lines.push({ accountId: adv!, debit: b.advanceApplied, customerId: b.customer.id, memo: `Advance applied · ${b.account.accountNo}` });
    lines.push({ accountId: ar!, credit: b.advanceApplied, customerId: b.customer.id, memo: `Advance applied · ${b.account.accountNo}` });
  }
  return lines;
}

async function insertBills(tx: Tx, bills: DraftBill[], period: BillingPeriod, jeId: string, actorId: string, isFinal = false): Promise<WaterBill[]> {
  const out: WaterBill[] = [];
  // Bill numbers follow the reading route and sequence (the order bills are printed and delivered).
  for (const b of bills) {
    const billNo = await nextNumber("WB", tx, `${period.period}-01`);
    const [row] = await tx
      .insert(waterBills)
      .values({
        billNo,
        accountId: b.account.id,
        customerId: b.customer.id,
        periodId: period.id,
        readingId: b.reading.id,
        customerType: b.customer.type,
        classification: b.account.classification,
        consumption: b.consumption,
        basicCharge: b.basicCharge,
        seniorDiscount: b.seniorDiscount,
        otherCharges: b.otherCharges,
        advanceApplied: b.advanceApplied,
        currentAmount: b.currentAmount,
        previousBalance: b.previousBalance,
        totalAmountDue: b.totalAmountDue,
        billDate: period.billDate,
        dueDate: period.dueDate,
        isFinal,
        jeId,
        createdBy: actorId,
      })
      .returning();
    if (!row) throw new Error("bill insert returned no row");
    await tx.insert(waterBillLines).values(b.lines.map((l, i) => ({ billId: row.id, lineNo: i + 1, kind: l.kind, description: l.description, qty: l.qty, rate: l.rate, amount: l.amount, createdBy: actorId })));
    out.push(row);
  }
  return out;
}

export type RunResult = { bills: number; jeId: string; total: string };

/**
 * Posts a zone's billing run once (runOnce "water-billing" "{period}:{zone}"). Blocked until
 * every billable account has an APPROVED reading or an approved exclusion.
 */
export async function postRun(tx: Tx, periodId: string, actorId: string): Promise<RunResult> {
  const period = await lockPeriod(tx, periodId);
  const [zone] = await tx.select().from(waterZones).where(eq(waterZones.id, period.zoneId));
  if (!zone) throw new WaterError("Zone not found");
  const label = `${zone.code} ${period.period}`;
  if (period.status === "BILLED" || period.status === "CLOSED") throw new WaterError(`${label} is already billed`);
  return runOnce(
    tx,
    "water-billing",
    `${period.period}:${zone.code}`,
    actorId,
    async () => {
      const { bills, blockers } = await computeRun(tx, period);
      if (blockers.length) {
        throw new WaterError(`Not ready to bill ${label}: ${blockers.map((b) => `${b.accountNo} (${b.problem})`).join(", ")}`);
      }
      if (bills.length === 0) throw new WaterError(`There are no accounts to bill in ${label}`);
      const je = await postJournal(
        tx,
        { date: period.billDate, book: "SJ", particulars: `Water billing ${label}`, reference: `${period.period}:${zone.code}`, source: { module: "water-billing", id: period.id }, lines: await journalLinesFor(tx, bills) },
        actorId,
      );
      const rows = await insertBills(tx, bills, period, je.id, actorId);
      await tx.update(waterBillingPeriods).set({ status: "BILLED" }).where(eq(waterBillingPeriods.id, period.id));
      const total = rows.reduce((s, b) => s + b.currentAmount, 0n);
      await audit(tx, { action: "water.billing_run", entity: "water_billing_period", entityId: period.id, after: { period: period.period, zone: zone.code, bills: rows.length, total: format(total), jeId: je.id }, userId: actorId });
      return { bills: rows.length, jeId: je.id, total: String(total) };
    },
    () => `${label} is already billed`,
  );
}

// ── Credit / debit memos (T6.7) ──

export async function prepareAdjustment(tx: Tx, input: { billId: string; kind: AdjustmentKind; amount: Money; reason: string }, actorId: string) {
  const [bill] = await tx.select().from(waterBills).where(eq(waterBills.id, input.billId));
  if (!bill) throw new WaterError("Bill not found");
  if (bill.status === "CANCELLED") throw new WaterError(`${bill.billNo} is cancelled`);
  if (input.amount <= 0n) throw new WaterError("The amount must be more than zero");
  if (!input.reason.trim()) throw new WaterError("A reason is required");
  if (input.kind === "CREDIT") {
    const credited = await approvedMemoTotal(tx, bill.id);
    const maxCredit = bill.currentAmount - bill.advanceApplied + credited.debit - credited.credit;
    if (input.amount > maxCredit) throw new WaterError(`A credit memo on ${bill.billNo} can be at most ${format(maxCredit)}`);
  }
  const [row] = await tx.insert(waterBillAdjustments).values({ billId: bill.id, kind: input.kind, amount: input.amount, reason: input.reason.trim(), preparedBy: actorId, createdBy: actorId }).returning();
  if (!row) throw new Error("adjustment insert returned no row");
  await audit(tx, { action: "water.adjustment_prepare", entity: "water_bill_adjustment", entityId: row.id, after: { billNo: bill.billNo, kind: row.kind, amount: format(row.amount), reason: row.reason }, userId: actorId });
  return row;
}

async function approvedMemoTotal(db: Db | Tx, billId: string) {
  const rows = await db.select().from(waterBillAdjustments).where(and(eq(waterBillAdjustments.billId, billId), eq(waterBillAdjustments.status, "APPROVED")));
  return { credit: rows.filter((r) => r.kind === "CREDIT").reduce((s, r) => s + r.amount, 0n), debit: rows.filter((r) => r.kind === "DEBIT").reduce((s, r) => s + r.amount, 0n) };
}

/** Approves (approver ≠ preparer) and posts a memo: credit = Dr Water Revenue Adjustments / Cr AR–Water; debit = the reverse. */
export async function approveAdjustment(tx: Tx, adjustmentId: string, actorId: string) {
  const [adj] = await tx.select().from(waterBillAdjustments).where(eq(waterBillAdjustments.id, adjustmentId)).for("update");
  if (!adj) throw new WaterError("Memo not found");
  if (adj.status !== "PENDING") throw new WaterError(`This memo is already ${adj.status}`);
  assertNotSameUser(adj.preparedBy, actorId);
  const [bill] = await tx.select().from(waterBills).where(eq(waterBills.id, adj.billId));
  if (!bill) throw new WaterError("Bill not found");
  const [ar, rev] = await Promise.all([accountIdFor("ar_water", tx), accountIdFor("water_revenue_adjustments", tx)]);
  const arLine: LineInput = { accountId: ar, customerId: bill.customerId, memo: bill.billNo, ...(adj.kind === "CREDIT" ? { credit: adj.amount } : { debit: adj.amount }) };
  const revLine: LineInput = { accountId: rev, ...(adj.kind === "CREDIT" ? { debit: adj.amount } : { credit: adj.amount }) };
  const je = await postJournal(
    tx,
    {
      date: businessToday(),
      book: "GJ",
      particulars: `${adj.kind === "CREDIT" ? "Credit" : "Debit"} memo on ${bill.billNo}: ${adj.reason}`,
      reference: bill.billNo,
      source: { module: "water-adjustment", id: adj.id },
      lines: [arLine, revLine],
    },
    actorId,
  );
  await tx.update(waterBillAdjustments).set({ status: "APPROVED", approvedBy: actorId, approvedAt: now(), jeId: je.id }).where(eq(waterBillAdjustments.id, adj.id));
  await audit(tx, { action: "water.adjustment_approve", entity: "water_bill_adjustment", entityId: adj.id, after: { billNo: bill.billNo, kind: adj.kind, amount: format(adj.amount), jeId: je.id }, userId: actorId });
  return { jeId: je.id };
}

export async function rejectAdjustment(tx: Tx, adjustmentId: string, reason: string, actorId: string) {
  const [adj] = await tx.select().from(waterBillAdjustments).where(eq(waterBillAdjustments.id, adjustmentId)).for("update");
  if (!adj) throw new WaterError("Memo not found");
  if (adj.status !== "PENDING") throw new WaterError(`This memo is already ${adj.status}`);
  if (!reason.trim()) throw new WaterError("A reason is required");
  await tx.update(waterBillAdjustments).set({ status: "REJECTED", rejectedReason: reason.trim() }).where(eq(waterBillAdjustments.id, adj.id));
  await audit(tx, { action: "water.adjustment_reject", entity: "water_bill_adjustment", entityId: adj.id, after: { reason: reason.trim() }, userId: actorId });
}

// ── Final bill on closure (T6.8) ──

/**
 * Closes an account: a FINAL reading in the zone's current (unbilled) period, a final bill posted
 * at once in its own entry, the meter removed (back IN_STOCK) and the account CLOSED. The deposit
 * refund is Phase 07.
 */
export async function closeAccount(tx: Tx, input: { accountId: string; finalReading: number; rollover: boolean; reason: string }, actorId: string) {
  if (!input.reason.trim()) throw new WaterError("A reason is required");
  const [row] = await tx
    .select({ account: waterAccounts, zoneId: waterRoutes.zoneId })
    .from(waterAccounts)
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(eq(waterAccounts.id, input.accountId));
  if (!row) throw new WaterError("Account not found");
  const account = row.account;
  if (account.status !== "ACTIVE" && account.status !== "DISCONNECTED") throw new WaterError(`${account.accountNo} is ${account.status}`);
  const [open] = await tx
    .select()
    .from(waterBillingPeriods)
    .where(and(eq(waterBillingPeriods.zoneId, row.zoneId), inArray(waterBillingPeriods.status, ["OPEN", "READING", "REVIEW"])))
    .orderBy(asc(waterBillingPeriods.period))
    .limit(1);
  if (!open) throw new WaterError("Open this zone's billing period first; the final reading belongs to it");

  const entered = await enterReading(tx, { periodId: open.id, accountId: account.id, presentReading: input.finalReading, rollover: input.rollover, remarks: `Final reading: ${input.reason.trim()}` }, actorId, "OFFICE");
  const [reading] = await tx
    .update(waterReadings)
    .set({ type: "FINAL", status: "APPROVED", approvedBy: actorId, approvedAt: now() })
    .where(eq(waterReadings.id, entered.id))
    .returning();
  if (!reading) throw new Error("reading update returned no row");

  const [customer] = await tx.select().from(waterCustomers).where(eq(waterCustomers.id, account.customerId));
  if (!customer) throw new Error("customer not found");
  const draft = await draftBill(tx, { account, customer, reading, period: open.period, rateDate: open.readingTo, billDate: open.billDate, advanceAvailable: await advanceBalance(tx, customer.id) });
  const je = await postJournal(
    tx,
    { date: open.billDate, book: "SJ", particulars: `Final water bill ${account.accountNo}`, reference: `${open.period}:${account.accountNo}`, source: { module: "water-final-bill", id: account.id }, lines: await journalLinesFor(tx, [draft]) },
    actorId,
  );
  const [bill] = await insertBills(tx, [draft], open, je.id, actorId, true);

  const today = businessToday();
  const [inst] = await tx.select().from(waterMeterInstallations).where(and(eq(waterMeterInstallations.accountId, account.id), sql`${waterMeterInstallations.removedAt} IS NULL`));
  if (inst) {
    await tx.update(waterMeterInstallations).set({ removedAt: today, finalReading: input.finalReading, reason: `Account closed: ${input.reason.trim()}` }).where(eq(waterMeterInstallations.id, inst.id));
    await tx.update(waterMeters).set({ status: "IN_STOCK" }).where(eq(waterMeters.id, inst.meterId));
  }
  await tx.update(waterAccounts).set({ status: "CLOSED", closedAt: today, updatedAt: now() }).where(eq(waterAccounts.id, account.id));
  await tx.insert(waterAccountHistory).values({ accountId: account.id, event: "STATUS", fromValue: account.status, toValue: "CLOSED", ref: input.reason.trim(), at: now(), by: actorId, createdBy: actorId });
  await audit(tx, { action: "water.account_close", entity: "water_account", entityId: account.id, after: { accountNo: account.accountNo, finalReading: input.finalReading, billNo: bill?.billNo, amount: format(draft.currentAmount) }, userId: actorId });
  return { billId: bill!.id, billNo: bill!.billNo, jeId: je.id, period: await periodLabel(open, tx) };
}
