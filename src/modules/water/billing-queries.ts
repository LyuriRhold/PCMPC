import { and, asc, count, desc, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { normalizeName } from "@/lib/names";
import { users } from "@/modules/auth/schema";
import { readingContext } from "./readings";
import {
  waterAccounts,
  waterBillAdjustments,
  waterBillingExclusions,
  waterBillingPeriods,
  waterBillLines,
  waterBills,
  waterCustomers,
  waterMeters,
  waterReadings,
  waterRoutes,
  waterZones,
  type WaterReading,
} from "./schema";
import { customerName } from "./service";

/** Read models for the reading, billing and bill screens, the PDFs and the reading app. */

export async function listPeriods(db: Db | Tx = getDb()) {
  const rows = await db
    .select({ p: waterBillingPeriods, zoneCode: waterZones.code, zoneName: waterZones.name })
    .from(waterBillingPeriods)
    .innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId))
    .orderBy(desc(waterBillingPeriods.period), asc(waterZones.code))
    .limit(200);
  const ids = rows.map((r) => r.p.id);
  const readings = ids.length
    ? await db.select({ periodId: waterReadings.periodId, status: waterReadings.status, n: count() }).from(waterReadings).where(inArray(waterReadings.periodId, ids)).groupBy(waterReadings.periodId, waterReadings.status)
    : [];
  const bills = ids.length ? await db.select({ periodId: waterBills.periodId, n: count() }).from(waterBills).where(inArray(waterBills.periodId, ids)).groupBy(waterBills.periodId) : [];
  return rows.map((r) => ({
    ...r.p,
    zoneCode: r.zoneCode,
    zoneName: r.zoneName,
    readings: readings.filter((x) => x.periodId === r.p.id).reduce((s, x) => s + x.n, 0),
    flagged: readings.find((x) => x.periodId === r.p.id && x.status === "ENTERED")?.n ?? 0,
    bills: bills.find((x) => x.periodId === r.p.id)?.n ?? 0,
  }));
}

export async function listZones(db: Db | Tx = getDb()) {
  return db.select().from(waterZones).orderBy(asc(waterZones.code));
}

export async function getPeriod(periodId: string, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ p: waterBillingPeriods, zone: waterZones })
    .from(waterBillingPeriods)
    .innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId))
    .where(eq(waterBillingPeriods.id, periodId));
  return r ? { ...r.p, zone: r.zone } : null;
}

export type GridRow = {
  accountId: string;
  accountNo: string;
  sequenceNo: number;
  customerName: string;
  serviceAddress: string;
  status: string;
  meterSerial: string;
  digits: number;
  previous: number;
  average: number | null;
  estimatedSince: number;
  meterChanged: boolean;
  reading: WaterReading | null;
  excluded: string | null;
};

/**
 * Accounts of a period's zone by route in reading order, each with its previous reading, recent
 * average and this period's reading (if any). Accounts that already have a reading this period
 * stay listed even if they were closed since (final readings).
 */
export async function periodGrid(periodId: string, db: Db | Tx = getDb()) {
  const period = await getPeriod(periodId, db);
  if (!period) return null;
  const routes = await db.select().from(waterRoutes).where(eq(waterRoutes.zoneId, period.zoneId)).orderBy(asc(waterRoutes.code));
  const readings = await db.select().from(waterReadings).where(eq(waterReadings.periodId, periodId));
  const readAccounts = readings.map((r) => r.accountId);
  const accounts = routes.length
    ? await db
        .select({ account: waterAccounts, customer: waterCustomers })
        .from(waterAccounts)
        .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
        .where(
          and(
            inArray(waterAccounts.routeId, routes.map((r) => r.id)),
            readAccounts.length ? or(inArray(waterAccounts.status, ["ACTIVE", "DISCONNECTED"]), inArray(waterAccounts.id, readAccounts)) : inArray(waterAccounts.status, ["ACTIVE", "DISCONNECTED"]),
          ),
        )
        .orderBy(asc(waterAccounts.sequenceNo), asc(waterAccounts.accountNo))
    : [];
  const exclusions = await db.select().from(waterBillingExclusions).where(eq(waterBillingExclusions.periodId, periodId));
  const byAccount = new Map(readings.map((r) => [r.accountId, r]));

  const rows: Array<GridRow & { routeId: string }> = [];
  for (const { account, customer } of accounts) {
    let ctx;
    try {
      ctx = await readingContext(db, account, period);
    } catch {
      // A closed account's meter is gone; its final reading row still shows.
      ctx = null;
    }
    const reading = byAccount.get(account.id) ?? null;
    if (!ctx && !reading) continue;
    rows.push({
      routeId: account.routeId,
      accountId: account.id,
      accountNo: account.accountNo,
      sequenceNo: account.sequenceNo,
      customerName: customerName(customer),
      serviceAddress: account.serviceAddress,
      status: account.status,
      meterSerial: ctx?.meter.serialNo ?? "—",
      digits: ctx?.meter.digits ?? 4,
      previous: ctx ? (ctx.changes.length ? ctx.changes.at(-1)!.newInitial : ctx.previous) : (reading?.previousReading ?? 0),
      average: ctx?.history.length ? Math.round(ctx.history.reduce((s, h) => s + h, 0) / ctx.history.length) : null,
      estimatedSince: ctx?.estimatedSince ?? 0,
      meterChanged: (ctx?.changes.length ?? 0) > 0,
      reading,
      excluded: exclusions.find((e) => e.accountId === account.id)?.reason ?? null,
    });
  }
  return { period, routes: routes.map((r) => ({ ...r, rows: rows.filter((x) => x.routeId === r.id) })) };
}

/** Routes assigned to a reader, with their zones' open periods (for the reading app). */
export async function readerWork(readerId: string, db: Db | Tx = getDb()) {
  const routes = await db
    .select({ route: waterRoutes, zone: waterZones })
    .from(waterRoutes)
    .innerJoin(waterZones, eq(waterZones.id, waterRoutes.zoneId))
    .where(eq(waterRoutes.assignedReaderId, readerId))
    .orderBy(asc(waterRoutes.code));
  const zoneIds = [...new Set(routes.map((r) => r.zone.id))];
  const periods = zoneIds.length
    ? await db
        .select()
        .from(waterBillingPeriods)
        .where(and(inArray(waterBillingPeriods.zoneId, zoneIds), inArray(waterBillingPeriods.status, ["OPEN", "READING", "REVIEW"])))
        .orderBy(asc(waterBillingPeriods.period))
    : [];
  const out = [];
  for (const { route, zone } of routes) {
    const period = periods.find((p) => p.zoneId === zone.id);
    if (!period) {
      out.push({ routeId: route.id, routeCode: route.code, routeName: route.name, zoneCode: zone.code, period: null, accounts: [] });
      continue;
    }
    const grid = await periodGrid(period.id, db);
    const rows = grid?.routes.find((r) => r.id === route.id)?.rows ?? [];
    out.push({
      routeId: route.id,
      routeCode: route.code,
      routeName: route.name,
      zoneCode: zone.code,
      period: { id: period.id, period: period.period },
      accounts: rows.map((r) => ({
        accountId: r.accountId,
        accountNo: r.accountNo,
        sequenceNo: r.sequenceNo,
        customerName: r.customerName,
        serviceAddress: r.serviceAddress,
        meterSerial: r.meterSerial,
        digits: r.digits,
        previous: r.previous,
        average: r.average,
        estimatedSince: r.estimatedSince,
        readPresent: r.reading?.presentReading ?? null,
      })),
    });
  }
  return out;
}

export async function listReaders(db: Db | Tx = getDb()) {
  return db.select({ id: users.id, name: users.name, username: users.username }).from(users).where(and(eq(users.roleCode, "METER_READER"), eq(users.isActive, true))).orderBy(asc(users.name));
}

export async function periodBills(periodId: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ bill: waterBills, account: waterAccounts, customer: waterCustomers })
    .from(waterBills)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .where(eq(waterBills.periodId, periodId))
    .orderBy(asc(waterAccounts.routeId), asc(waterAccounts.sequenceNo));
  return rows.map((r) => ({ ...r.bill, accountNo: r.account.accountNo, routeId: r.account.routeId, customerName: customerName(r.customer) }));
}

export async function searchBills(opts: { q?: string }, db: Db | Tx = getDb()) {
  const q = (opts.q ?? "").trim();
  const tokens = normalizeName(q).split(" ").filter(Boolean);
  const clean = q.toUpperCase().replaceAll("%", "").replaceAll("_", "");
  const rows = await db
    .select({ bill: waterBills, accountNo: waterAccounts.accountNo, customer: waterCustomers, period: waterBillingPeriods.period })
    .from(waterBills)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(q ? or(like(waterBills.billNo, `%${clean}%`), like(waterAccounts.accountNo, `%${clean}%`), and(...tokens.map((t) => like(waterCustomers.searchText, `%${t}%`)))) : undefined)
    .orderBy(desc(waterBills.billNo))
    .limit(200);
  return rows.map((r) => ({ ...r.bill, accountNo: r.accountNo, period: r.period, customerName: customerName(r.customer) }));
}

/** A bill with everything printed on it: lines, reading, memos and the last 6 months of use. */
export async function billDetail(billId: string, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ bill: waterBills, account: waterAccounts, customer: waterCustomers, period: waterBillingPeriods, reading: waterReadings, zone: waterZones, route: waterRoutes, meterSerial: waterMeters.serialNo })
    .from(waterBills)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterBills.accountId))
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterBills.customerId))
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .innerJoin(waterReadings, eq(waterReadings.id, waterBills.readingId))
    .innerJoin(waterZones, eq(waterZones.id, waterBillingPeriods.zoneId))
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .innerJoin(waterMeters, eq(waterMeters.id, waterReadings.meterId))
    .where(eq(waterBills.id, billId));
  if (!r) return null;
  const lines = await db.select().from(waterBillLines).where(eq(waterBillLines.billId, billId)).orderBy(asc(waterBillLines.lineNo));
  const memos = await db.select().from(waterBillAdjustments).where(eq(waterBillAdjustments.billId, billId)).orderBy(asc(waterBillAdjustments.createdAt));
  const history = await db
    .select({ period: waterBillingPeriods.period, consumption: waterReadings.consumption, type: waterReadings.type })
    .from(waterReadings)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterReadings.periodId))
    .where(and(eq(waterReadings.accountId, r.account.id), lt(waterBillingPeriods.period, r.period.period), sql`${waterReadings.status} <> 'REJECTED'`))
    .orderBy(desc(waterBillingPeriods.period))
    .limit(6);
  const userIds = [...new Set(memos.flatMap((m) => [m.preparedBy, m.approvedBy]).filter((v): v is string => !!v))];
  const names = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  return {
    bill: r.bill,
    account: r.account,
    customer: { id: r.customer.id, customerNo: r.customer.customerNo, name: customerName(r.customer), address: r.customer.address },
    period: r.period,
    zone: r.zone,
    route: r.route,
    reading: r.reading,
    meterSerial: r.meterSerial,
    lines,
    memos: memos.map((m) => ({ ...m, preparedByName: names.find((n) => n.id === m.preparedBy)?.name ?? "", approvedByName: names.find((n) => n.id === m.approvedBy)?.name ?? null })),
    history: [{ period: r.period.period, consumption: r.reading.consumption, type: r.reading.type }, ...history].slice(0, 6),
  };
}

export type BillDetail = NonNullable<Awaited<ReturnType<typeof billDetail>>>;

export async function pendingMemos(db: Db | Tx = getDb()) {
  const rows = await db
    .select({ memo: waterBillAdjustments, billNo: waterBills.billNo, billId: waterBills.id, preparedByName: users.name })
    .from(waterBillAdjustments)
    .innerJoin(waterBills, eq(waterBills.id, waterBillAdjustments.billId))
    .innerJoin(users, eq(users.id, waterBillAdjustments.preparedBy))
    .where(eq(waterBillAdjustments.status, "PENDING"))
    .orderBy(asc(waterBillAdjustments.createdAt));
  return rows.map((r) => ({ ...r.memo, billNo: r.billNo, preparedByName: r.preparedByName }));
}

export async function accountBills(accountId: string, db: Db | Tx = getDb()) {
  return db
    .select({ bill: waterBills, period: waterBillingPeriods.period })
    .from(waterBills)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterBills.periodId))
    .where(eq(waterBills.accountId, accountId))
    .orderBy(desc(waterBillingPeriods.period));
}
