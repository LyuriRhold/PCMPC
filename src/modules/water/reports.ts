import Decimal from "decimal.js";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addDays, daysBetween, monthEnd, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { users } from "@/modules/auth/schema";
import { receiptItems, receipts, tellerSessions } from "@/modules/cashiering/schema";
import { journalEntries } from "@/modules/ledger/schema";
import { billBalances, disconnectionList } from "./collections";
import {
  waterAccounts,
  waterBillAdjustments,
  waterBillingPeriods,
  waterBills,
  waterCustomers,
  waterDepositSettlements,
  waterDisconnections,
  waterPaymentAllocations,
  waterPenalties,
  waterProductionReadings,
  waterReadings,
  waterRoutes,
  waterZones,
} from "./schema";
import { customerName, WaterError } from "./service";

/**
 * Water reports (PHASE-07 T7.7). Each report returns plain rows; the pages render them and the
 * export route turns the same rows into Excel. Amounts are centavos (bigint).
 */

const sum = (xs: Money[]) => xs.reduce((s, x) => s + x, 0n);

/** Percent with 2 decimals, HALF-UP; null when the base is 0. */
export function percent(part: Money | number, whole: Money | number): string | null {
  if (BigInt(whole) === 0n) return null;
  return new Decimal(String(part)).mul(100).div(String(whole)).toFixed(2, Decimal.ROUND_HALF_UP);
}

// ── AR aging ──

export type AgingRow = { accountId: string; accountNo: string; customerName: string; current: Money; d1_30: Money; d31_60: Money; d61_90: Money; over90: Money; total: Money };

/** Unpaid bills (with penalties) as of a date, bucketed by days past due. */
export async function agingReport(asOf: BusinessDate, db: Db | Tx = getDb()) {
  const open = (await billBalances(db, { asOf })).filter((b) => b.outstanding > 0n);
  const accounts = open.length
    ? await db
        .select({ id: waterAccounts.id, accountNo: waterAccounts.accountNo, customer: waterCustomers })
        .from(waterAccounts)
        .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
        .where(inArray(waterAccounts.id, [...new Set(open.map((b) => b.accountId))]))
    : [];
  const bills = open.map((b) => ({ accountId: b.accountId, billNo: b.billNo, dueDate: b.dueDate, daysPastDue: daysBetween(b.dueDate, asOf), amount: b.outstanding }));
  const rows: AgingRow[] = accounts
    .map((a) => {
      const mine = bills.filter((b) => b.accountId === a.id);
      const bucket = (lo: number, hi: number) => sum(mine.filter((b) => b.daysPastDue >= lo && b.daysPastDue <= hi).map((b) => b.amount));
      return {
        accountId: a.id,
        accountNo: a.accountNo,
        customerName: customerName(a.customer),
        current: bucket(Number.MIN_SAFE_INTEGER, 0),
        d1_30: bucket(1, 30),
        d31_60: bucket(31, 60),
        d61_90: bucket(61, 90),
        over90: bucket(91, Number.MAX_SAFE_INTEGER),
        total: sum(mine.map((b) => b.amount)),
      };
    })
    .sort((x, y) => x.accountNo.localeCompare(y.accountNo));
  const totals = {
    current: sum(rows.map((r) => r.current)),
    d1_30: sum(rows.map((r) => r.d1_30)),
    d31_60: sum(rows.map((r) => r.d31_60)),
    d61_90: sum(rows.map((r) => r.d61_90)),
    over90: sum(rows.map((r) => r.over90)),
    total: sum(rows.map((r) => r.total)),
  };
  return { asOf, rows, bills, totals };
}

// ── Billing summary ──

export type SummaryRow = { zone: string; classification: string; customerType: string; bills: number; consumption: number; basic: Money; seniorDiscount: Money; net: Money };

/** Bills of a period by zone × class × member/non-member: basic charge, senior discount, net billed. */
export async function billingSummary(period: string, db: Db | Tx = getDb()) {
  const bills = await db
    .select({ bill: waterBills, zone: waterZones.code })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId))
    .where(and(eq(waterBillingPeriods.period, period), sql`${waterBills.status} <> 'CANCELLED'`));
  const groups = new Map<string, SummaryRow>();
  for (const { bill, zone } of bills) {
    const key = `${zone}|${bill.classification}|${bill.customerType}`;
    const g = groups.get(key) ?? { zone, classification: bill.classification, customerType: bill.customerType, bills: 0, consumption: 0, basic: 0n, seniorDiscount: 0n, net: 0n };
    g.bills += 1;
    g.consumption += bill.consumption;
    g.basic += bill.basicCharge + bill.otherCharges;
    g.seniorDiscount += bill.seniorDiscount;
    g.net += bill.currentAmount;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => `${a.zone}${a.classification}${a.customerType}`.localeCompare(`${b.zone}${b.classification}${b.customerType}`));
  const totals = {
    bills: rows.reduce((s, r) => s + r.bills, 0),
    consumption: rows.reduce((s, r) => s + r.consumption, 0),
    members: sum(rows.filter((r) => r.customerType === "MEMBER").map((r) => r.basic)),
    nonMembers: sum(rows.filter((r) => r.customerType !== "MEMBER").map((r) => r.basic)),
    seniorDiscount: sum(rows.map((r) => r.seniorDiscount)),
    net: sum(rows.map((r) => r.net)),
  };
  return { period, rows, totals };
}

// ── Collection efficiency ──

/** Collected on bills due in the month (payments and advances applied, not penalties) ÷ billed amount due in the month. */
export async function collectionEfficiency(month: string, db: Db | Tx = getDb()) {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const bills = await db
    .select({ id: waterBills.id, current: waterBills.currentAmount, advance: waterBills.advanceApplied })
    .from(waterBills)
    .where(and(gte(waterBills.dueDate, from), lte(waterBills.dueDate, to), sql`${waterBills.status} <> 'CANCELLED'`));
  const billed = sum(bills.map((b) => b.current));
  const balances = await billBalances(db, { billIds: bills.map((b) => b.id) });
  const collected = sum(balances.map((b) => b.billPaid)) + sum(bills.map((b) => b.advance));
  return { month, billed, collected, percent: percent(collected, billed) };
}

// ── Customer SOA ──

export type SoaLine = { date: BusinessDate; kind: "BILL" | "ADVANCE_APPLIED" | "PENALTY" | "PAYMENT" | "CREDIT_MEMO" | "DEBIT_MEMO" | "DEPOSIT_OFFSET"; reference: string; description: string; debit: Money; credit: Money; balance: Money };

const KIND_ORDER: Record<SoaLine["kind"], number> = { BILL: 0, ADVANCE_APPLIED: 1, PENALTY: 2, DEBIT_MEMO: 3, CREDIT_MEMO: 4, PAYMENT: 5, DEPOSIT_OFFSET: 6 };

/**
 * Statement of account built from the water records (bills, advances applied, penalties, memos,
 * payments, deposit offsets) with a running balance; it equals the customer's AR–Water subsidiary.
 */
export async function customerSoa(customerId: string, db: Db | Tx = getDb()) {
  const [customer] = await db.select().from(waterCustomers).where(eq(waterCustomers.id, customerId));
  if (!customer) throw new WaterError("Customer not found");
  const bills = await db
    .select({ bill: waterBills, accountNo: waterAccounts.accountNo, period: waterBillingPeriods.period })
    .from(waterBills)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(and(eq(waterBills.customerId, customerId), sql`${waterBills.status} <> 'CANCELLED'`));
  const ids = bills.map((b) => b.bill.id);
  const lines: Omit<SoaLine, "balance">[] = [];
  for (const { bill, accountNo, period } of bills) {
    lines.push({ date: bill.billDate, kind: "BILL", reference: bill.billNo, description: `Water bill ${period} · ${accountNo} · ${bill.consumption} m³`, debit: bill.currentAmount, credit: 0n });
    if (bill.advanceApplied > 0n) lines.push({ date: bill.billDate, kind: "ADVANCE_APPLIED", reference: bill.billNo, description: "Advance payment applied", debit: 0n, credit: bill.advanceApplied });
  }
  if (ids.length) {
    const billNo = (id: string) => bills.find((b) => b.bill.id === id)?.bill.billNo ?? "";
    for (const p of await db.select().from(waterPenalties).where(inArray(waterPenalties.billId, ids))) {
      lines.push({ date: p.assessedOn, kind: "PENALTY", reference: billNo(p.billId), description: "Late-payment penalty", debit: p.amount, credit: 0n });
    }
    const memos = await db
      .select({ m: waterBillAdjustments, date: journalEntries.entryDate })
      .from(waterBillAdjustments)
      .innerJoin(journalEntries, eq(journalEntries.id, waterBillAdjustments.jeId))
      .where(and(inArray(waterBillAdjustments.billId, ids), eq(waterBillAdjustments.status, "APPROVED")));
    for (const { m, date } of memos) {
      lines.push(
        m.kind === "CREDIT"
          ? { date, kind: "CREDIT_MEMO", reference: billNo(m.billId), description: `Credit memo: ${m.reason}`, debit: 0n, credit: m.amount }
          : { date, kind: "DEBIT_MEMO", reference: billNo(m.billId), description: `Debit memo: ${m.reason}`, debit: m.amount, credit: 0n },
      );
    }
    const paid = await db
      .select({ receiptNo: receipts.receiptNo, date: receipts.receiptDate, amount: sql<string>`SUM(${waterPaymentAllocations.penaltyPart} + ${waterPaymentAllocations.billPart})` })
      .from(waterPaymentAllocations)
      .innerJoin(receiptItems, eq(receiptItems.id, waterPaymentAllocations.receiptItemId))
      .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .where(and(inArray(waterPaymentAllocations.billId, ids), eq(receipts.status, "VALID")))
      .groupBy(receipts.receiptNo, receipts.receiptDate);
    for (const p of paid) lines.push({ date: p.date, kind: "PAYMENT", reference: p.receiptNo, description: "Payment", debit: 0n, credit: BigInt(p.amount) });
    const offsets = await db
      .select({ date: journalEntries.entryDate, amount: sql<string>`SUM(${waterPaymentAllocations.penaltyPart} + ${waterPaymentAllocations.billPart})`, accountNo: waterAccounts.accountNo })
      .from(waterPaymentAllocations)
      .innerJoin(waterDepositSettlements, eq(waterDepositSettlements.id, waterPaymentAllocations.settlementId))
      .innerJoin(journalEntries, eq(journalEntries.id, waterDepositSettlements.offsetJeId))
      .innerJoin(waterAccounts, eq(waterAccounts.id, waterDepositSettlements.accountId))
      .where(inArray(waterPaymentAllocations.billId, ids))
      .groupBy(journalEntries.entryDate, waterAccounts.accountNo);
    for (const o of offsets) lines.push({ date: o.date, kind: "DEPOSIT_OFFSET", reference: o.accountNo, description: "Meter deposit applied", debit: 0n, credit: BigInt(o.amount) });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.reference.localeCompare(b.reference));
  let balance = 0n;
  const withBalance: SoaLine[] = lines.map((l) => {
    balance += l.debit - l.credit;
    return { ...l, balance };
  });
  return { customer: { id: customer.id, customerNo: customer.customerNo, name: customerName(customer), address: customer.address }, lines: withBalance, endingBalance: balance };
}

// ── Other water reports ──

/** Water bill payments received on a date, per teller. */
export async function dailyCollections(date: BusinessDate, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ receiptNo: receipts.receiptNo, payor: receipts.payorName, amount: receiptItems.amount, description: receiptItems.description, teller: users.name })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .innerJoin(tellerSessions, eq(tellerSessions.id, receipts.sessionId))
    .innerJoin(users, eq(users.id, tellerSessions.tellerId))
    .where(and(eq(receipts.receiptDate, date), eq(receipts.status, "VALID"), sql`${receiptItems.type} IN ('WATER_BILL', 'WATER_CONNECTION_FEE', 'METER_DEPOSIT', 'WATER_OTHER_FEE')`))
    .orderBy(asc(users.name), asc(receipts.receiptNo));
  return { date, rows, total: sum(rows.map((r) => r.amount)) };
}

/** Consumption and billed amount by zone and route for a period. */
export async function consumptionByRoute(period: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({
      zone: waterZones.code,
      route: waterRoutes.code,
      accounts: sql<number>`COUNT(*)::int`,
      consumption: sql<number>`COALESCE(SUM(${waterBills.consumption}), 0)::int`,
      billed: sql<string>`COALESCE(SUM(${waterBills.currentAmount}), 0)`,
    })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId))
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(and(eq(waterBillingPeriods.period, period), sql`${waterBills.status} <> 'CANCELLED'`))
    .groupBy(waterZones.code, waterRoutes.code)
    .orderBy(asc(waterZones.code), asc(waterRoutes.code));
  return { period, rows: rows.map((r) => ({ ...r, billed: BigInt(r.billed) })) };
}

/** The biggest consumers in a period. */
export async function topConsumers(period: string, limit = 20, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ accountNo: waterAccounts.accountNo, customer: waterCustomers, classification: waterBills.classification, consumption: waterBills.consumption, amount: waterBills.currentAmount })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .where(eq(waterBillingPeriods.period, period))
    .orderBy(desc(waterBills.consumption))
    .limit(limit);
  return { period, rows: rows.map((r) => ({ accountNo: r.accountNo, customerName: customerName(r.customer), classification: r.classification, consumption: r.consumption, amount: r.amount })) };
}

/** Accounts read at zero or estimated in a period. */
export async function zeroAndEstimated(period: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ accountNo: waterAccounts.accountNo, customer: waterCustomers, type: waterReadings.type, consumption: waterReadings.consumption, remarks: waterReadings.remarks })
    .from(waterReadings)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterReadings.periodId))
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterReadings.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .where(and(eq(waterBillingPeriods.period, period), sql`(${waterReadings.consumption} = 0 OR ${waterReadings.type} = 'ESTIMATED')`, sql`${waterReadings.status} <> 'REJECTED'`))
    .orderBy(asc(waterAccounts.accountNo));
  return { period, rows: rows.map((r) => ({ accountNo: r.accountNo, customerName: customerName(r.customer), type: r.type, consumption: r.consumption, remarks: r.remarks ?? "" })) };
}

/** Senior-citizen discounts granted in a period. */
export async function seniorDiscounts(period: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ billNo: waterBills.billNo, accountNo: waterAccounts.accountNo, customer: waterCustomers, consumption: waterBills.consumption, basic: waterBills.basicCharge, discount: waterBills.seniorDiscount })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .where(and(eq(waterBillingPeriods.period, period), sql`${waterBills.seniorDiscount} > 0`))
    .orderBy(asc(waterAccounts.accountNo));
  return { period, rows: rows.map((r) => ({ billNo: r.billNo, accountNo: r.accountNo, customerName: customerName(r.customer), consumption: r.consumption, basic: r.basic, discount: r.discount })), total: sum(rows.map((r) => r.discount)) };
}

/** Disconnections and reconnections in a date range. */
export async function reconnectionLog(from: BusinessDate, to: BusinessDate, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ d: waterDisconnections, accountNo: waterAccounts.accountNo, customer: waterCustomers })
    .from(waterDisconnections)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterDisconnections.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .where(and(gte(waterDisconnections.noticeDate, from), lte(waterDisconnections.noticeDate, to)))
    .orderBy(asc(waterDisconnections.noticeDate), asc(waterDisconnections.noticeNo));
  return {
    rows: rows.map((r) => ({
      noticeNo: r.d.noticeNo,
      accountNo: r.accountNo,
      customerName: customerName(r.customer),
      noticeDate: r.d.noticeDate,
      disconnectedAt: r.d.disconnectedAt ?? "",
      reconnectedAt: r.d.reconnectedAt ?? "",
      status: r.d.status,
      amount: r.d.noticeAmount,
    })),
  };
}

// ── Production readings and NRW ──

export async function addProductionReading(tx: Tx, input: { source: string; readingDate: BusinessDate; reading: number }, actorId: string) {
  const source = input.source.trim().toUpperCase();
  const [prev] = await tx
    .select()
    .from(waterProductionReadings)
    .where(and(eq(waterProductionReadings.source, source), sql`${waterProductionReadings.readingDate} < ${input.readingDate}`))
    .orderBy(desc(waterProductionReadings.readingDate))
    .limit(1);
  if (prev && input.reading < prev.reading) throw new WaterError(`The reading is lower than ${source}'s previous reading (${prev.reading.toLocaleString("en-US")})`);
  const [dup] = await tx.select({ id: waterProductionReadings.id }).from(waterProductionReadings).where(and(eq(waterProductionReadings.source, source), eq(waterProductionReadings.readingDate, input.readingDate)));
  if (dup) throw new WaterError(`${source} already has a reading on ${input.readingDate}`);
  const [row] = await tx.insert(waterProductionReadings).values({ source, readingDate: input.readingDate, reading: input.reading, createdBy: actorId }).returning();
  if (!row) throw new Error("production reading insert returned no row");
  await audit(tx, { action: "water.production_reading", entity: "water_production_reading", entityId: row.id, after: { source, readingDate: row.readingDate, reading: row.reading }, userId: actorId });
}

/**
 * Non-revenue water for a billing period: water produced in the month (each source's last
 * reading in the month minus its last reading before the month) vs m³ billed for the period.
 */
export async function nrw(period: string, db: Db | Tx = getDb()) {
  const from = `${period}-01`;
  const to = monthEnd(from);
  const readings = await db.select().from(waterProductionReadings).where(lte(waterProductionReadings.readingDate, to)).orderBy(asc(waterProductionReadings.readingDate));
  let produced = 0;
  let measured = false;
  for (const source of new Set(readings.map((r) => r.source))) {
    const mine = readings.filter((r) => r.source === source);
    const before = mine.filter((r) => r.readingDate < from).at(-1);
    const end = mine.filter((r) => r.readingDate >= from).at(-1);
    if (before && end) {
      produced += end.reading - before.reading;
      measured = true;
    }
  }
  const [b] = await db
    .select({ m3: sql<number>`COALESCE(SUM(${waterBills.consumption}), 0)::int` })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(and(eq(waterBillingPeriods.period, period), sql`${waterBills.status} <> 'CANCELLED'`));
  const billed = b?.m3 ?? 0;
  return { period, produced: measured ? produced : null, billed, nrwM3: measured ? produced - billed : null, nrwPercent: measured && produced > 0 ? percent(produced - billed, produced) : null };
}

export async function productionReadings(db: Db | Tx = getDb()) {
  return db.select().from(waterProductionReadings).orderBy(desc(waterProductionReadings.readingDate), asc(waterProductionReadings.source)).limit(100);
}

// ── Dashboard tiles ──

/** Billed and collected this month, collection efficiency (bills due this month), disconnection list size, NRW %. */
export async function waterTiles(month: string, db: Db | Tx = getDb()) {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const [billed] = await db
    .select({ total: sql<string>`COALESCE(SUM(${waterBills.currentAmount}), 0)` })
    .from(waterBills)
    .where(and(gte(waterBills.billDate, from), lte(waterBills.billDate, to), sql`${waterBills.status} <> 'CANCELLED'`));
  const [collected] = await db
    .select({ total: sql<string>`COALESCE(SUM(${receiptItems.amount}), 0)` })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(receiptItems.type, "WATER_BILL"), eq(receipts.status, "VALID"), gte(receipts.receiptDate, from), lte(receipts.receiptDate, to)));
  const efficiency = await collectionEfficiency(month, db);
  const forDisconnection = (await disconnectionList(db)).length;
  const prevMonth = addDays(from, -1).slice(0, 7);
  const nrwNow = await nrw(month, db);
  const nrwPrev = nrwNow.nrwPercent === null ? await nrw(prevMonth, db) : null;
  return {
    month,
    billed: BigInt(billed?.total ?? "0"),
    collected: BigInt(collected?.total ?? "0"),
    efficiency: efficiency.percent,
    forDisconnection,
    nrwPercent: nrwNow.nrwPercent ?? nrwPrev?.nrwPercent ?? null,
  };
}

/** The latest penalties assessed, newest first. */
export async function recentPenalties(limit = 50, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ p: waterPenalties, billNo: waterBills.billNo, dueDate: waterBills.dueDate, accountNo: waterAccounts.accountNo, customer: waterCustomers })
    .from(waterPenalties)
    .innerJoin(waterBills, eq(waterBills.id, waterPenalties.billId))
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .orderBy(desc(waterPenalties.assessedOn), asc(waterBills.billNo))
    .limit(limit);
  return rows.map((r) => ({ id: r.p.id, assessedOn: r.p.assessedOn, amount: r.p.amount, billNo: r.billNo, dueDate: r.dueDate, accountNo: r.accountNo, customerName: customerName(r.customer) }));
}
