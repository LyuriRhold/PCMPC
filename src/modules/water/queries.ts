import { and, asc, count, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { normalizeName } from "@/lib/names";
import { maskTail } from "@/modules/members/masking";
import { users } from "@/modules/auth/schema";
import {
  waterAccountHistory,
  waterAccounts,
  waterApplications,
  waterCustomers,
  waterFees,
  waterMeterInstallations,
  waterMeters,
  waterRateSchedules,
  waterRoutes,
  waterSeniorEligibility,
  waterZones,
  type ApplicationStatus,
  type WaterCustomer,
} from "./schema";
import { customerName, feePaid } from "./service";

/**
 * Read models for the water pages. Customer mobile and ID numbers are masked server-side unless
 * the viewer has `members.read_sensitive` (Q-05.5, same rule as members).
 */

export type CustomerView = Omit<WaterCustomer, "nameKey" | "searchText"> & { name: string };

function toView(c: WaterCustomer, canSeeSensitive: boolean): CustomerView {
  const view: CustomerView = {
    id: c.id,
    customerNo: c.customerNo,
    type: c.type,
    memberId: c.memberId,
    lastName: c.lastName,
    firstName: c.firstName,
    middleName: c.middleName,
    businessName: c.businessName,
    address: c.address,
    mobile: c.mobile,
    email: c.email,
    validIdType: c.validIdType,
    validIdNo: c.validIdNo,
    privacyConsentAt: c.privacyConsentAt,
    remarks: c.remarks,
    createdAt: c.createdAt,
    createdBy: c.createdBy,
    updatedAt: c.updatedAt,
    name: customerName(c),
  };
  return canSeeSensitive ? view : { ...view, mobile: maskTail(view.mobile), validIdNo: maskTail(view.validIdNo) };
}

const clean = (q: string) => q.trim().toUpperCase().replaceAll("%", "").replaceAll("_", "");

export async function searchCustomers(opts: { q?: string; page?: number; pageSize?: number }, db: Db | Tx = getDb()) {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const tokens = normalizeName(opts.q ?? "").split(" ").filter(Boolean);
  let where = undefined;
  if (tokens.length) {
    const byAccount = await db.select({ id: waterAccounts.customerId }).from(waterAccounts).where(like(waterAccounts.accountNo, `%${clean(opts.q ?? "")}%`)).limit(50);
    where = or(and(...tokens.map((t) => like(waterCustomers.searchText, `%${t}%`))), byAccount.length ? inArray(waterCustomers.id, byAccount.map((r) => r.id)) : undefined);
  }
  const [total] = await db.select({ n: count() }).from(waterCustomers).where(where);
  const rows = await db
    .select()
    .from(waterCustomers)
    .where(where)
    .orderBy(desc(waterCustomers.customerNo))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const ids = rows.map((r) => r.id);
  const accounts = ids.length
    ? await db.select({ customerId: waterAccounts.customerId, accountNo: waterAccounts.accountNo, status: waterAccounts.status }).from(waterAccounts).where(inArray(waterAccounts.customerId, ids)).orderBy(asc(waterAccounts.accountNo))
    : [];
  return {
    total: total?.n ?? 0,
    page,
    pageSize,
    rows: rows.map((c) => ({
      id: c.id,
      customerNo: c.customerNo,
      type: c.type,
      name: customerName(c),
      address: c.address,
      accounts: accounts.filter((a) => a.customerId === c.id),
    })),
  };
}

export async function getCustomer(id: string, canSeeSensitive: boolean, db: Db | Tx = getDb()) {
  const [c] = await db.select().from(waterCustomers).where(eq(waterCustomers.id, id));
  if (!c) return null;
  const accounts = await db.select().from(waterAccounts).where(eq(waterAccounts.customerId, id)).orderBy(asc(waterAccounts.accountNo));
  const applications = await db.select().from(waterApplications).where(eq(waterApplications.customerId, id)).orderBy(desc(waterApplications.appNo));
  return { customer: toView(c, canSeeSensitive), accounts, applications };
}

export async function listApplications(status: ApplicationStatus | undefined, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ app: waterApplications, customer: waterCustomers })
    .from(waterApplications)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterApplications.customerId))
    .where(status ? eq(waterApplications.status, status) : inArray(waterApplications.status, ["APPLIED", "INSPECTED", "APPROVED"]))
    .orderBy(asc(waterApplications.appNo))
    .limit(500);
  const accountIds = rows.map((r) => r.app.accountId).filter((v): v is string => !!v);
  const accounts = accountIds.length ? await db.select({ id: waterAccounts.id, accountNo: waterAccounts.accountNo }).from(waterAccounts).where(inArray(waterAccounts.id, accountIds)) : [];
  return rows.map((r) => ({ ...r.app, customerName: customerName(r.customer), customerNo: r.customer.customerNo, accountNo: accounts.find((a) => a.id === r.app.accountId)?.accountNo ?? null }));
}

export async function getApplication(id: string, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ app: waterApplications, customer: waterCustomers })
    .from(waterApplications)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterApplications.customerId))
    .where(eq(waterApplications.id, id));
  if (!r) return null;
  const [account] = r.app.accountId ? await db.select().from(waterAccounts).where(eq(waterAccounts.id, r.app.accountId)) : [];
  const [route] = r.app.routeId ? await db.select().from(waterRoutes).where(eq(waterRoutes.id, r.app.routeId)) : [];
  const userIds = [r.app.encodedBy, r.app.approvedBy, r.app.inspectedBy].filter((v): v is string => !!v);
  const names = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const nameOf = (uid: string | null) => names.find((u) => u.id === uid)?.name ?? null;
  return {
    application: r.app,
    customer: { id: r.customer.id, customerNo: r.customer.customerNo, name: customerName(r.customer), type: r.customer.type },
    account: account ?? null,
    route: route ?? null,
    encodedByName: nameOf(r.app.encodedBy),
    approvedByName: nameOf(r.app.approvedBy),
    inspectedByName: nameOf(r.app.inspectedBy),
    connectionFeePaid: await feePaid("WATER_CONNECTION_FEE", r.app.id, db),
    depositPaid: await feePaid("METER_DEPOSIT", r.app.id, db),
  };
}

/** Meters with the account they are installed at, if any. */
export async function listMeters(db: Db | Tx = getDb()) {
  const meters = await db.select().from(waterMeters).orderBy(asc(waterMeters.serialNo)).limit(2000);
  const active = await db
    .select({ meterId: waterMeterInstallations.meterId, accountId: waterAccounts.id, accountNo: waterAccounts.accountNo })
    .from(waterMeterInstallations)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterMeterInstallations.accountId))
    .where(isNull(waterMeterInstallations.removedAt));
  return meters.map((m) => ({ ...m, installedAt: active.find((a) => a.meterId === m.id) ?? null }));
}

/** Service accounts with customer, route and current meter. */
export async function listAccounts(opts: { q?: string } = {}, db: Db | Tx = getDb()) {
  const q = clean(opts.q ?? "");
  const tokens = normalizeName(opts.q ?? "").split(" ").filter(Boolean);
  const rows = await db
    .select({ account: waterAccounts, customer: waterCustomers, routeCode: waterRoutes.code })
    .from(waterAccounts)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(q ? or(like(waterAccounts.accountNo, `%${q}%`), and(...tokens.map((t) => like(waterCustomers.searchText, `%${t}%`)))) : undefined)
    .orderBy(asc(waterAccounts.accountNo))
    .limit(500);
  const meters = await currentMeters(rows.map((r) => r.account.id), db);
  return rows.map((r) => ({ ...r.account, customerName: customerName(r.customer), customerNo: r.customer.customerNo, routeCode: r.routeCode, meterSerial: meters.get(r.account.id)?.serialNo ?? null }));
}

async function currentMeters(accountIds: string[], db: Db | Tx) {
  if (!accountIds.length) return new Map<string, { serialNo: string; installedAt: string; initialReading: number }>();
  const rows = await db
    .select({ accountId: waterMeterInstallations.accountId, serialNo: waterMeters.serialNo, installedAt: waterMeterInstallations.installedAt, initialReading: waterMeterInstallations.initialReading })
    .from(waterMeterInstallations)
    .innerJoin(waterMeters, eq(waterMeters.id, waterMeterInstallations.meterId))
    .where(and(inArray(waterMeterInstallations.accountId, accountIds), isNull(waterMeterInstallations.removedAt)));
  return new Map(rows.map((r) => [r.accountId, r]));
}

export async function getAccount(id: string, canSeeSensitive: boolean, db: Db | Tx = getDb()) {
  const [r] = await db
    .select({ account: waterAccounts, customer: waterCustomers, route: waterRoutes })
    .from(waterAccounts)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(eq(waterAccounts.id, id));
  if (!r) return null;
  const installations = await db
    .select({ inst: waterMeterInstallations, serialNo: waterMeters.serialNo })
    .from(waterMeterInstallations)
    .innerJoin(waterMeters, eq(waterMeters.id, waterMeterInstallations.meterId))
    .where(eq(waterMeterInstallations.accountId, id))
    .orderBy(desc(waterMeterInstallations.installedAt), desc(waterMeterInstallations.createdAt));
  const history = await db.select().from(waterAccountHistory).where(eq(waterAccountHistory.accountId, id)).orderBy(desc(waterAccountHistory.at)).limit(200);
  const seniors = await db.select().from(waterSeniorEligibility).where(eq(waterSeniorEligibility.accountId, id)).orderBy(desc(waterSeniorEligibility.validFrom));
  return {
    account: r.account,
    customer: toView(r.customer, canSeeSensitive),
    route: r.route,
    installations: installations.map((i) => ({ ...i.inst, serialNo: i.serialNo })),
    current: installations.find((i) => i.inst.removedAt === null) ?? null,
    history,
    seniors: seniors.map((s) => (canSeeSensitive ? s : { ...s, oscaIdNo: maskTail(s.oscaIdNo) ?? "" })),
  };
}

/** Zones → routes → accounts in reading order. */
export async function routesWithAccounts(db: Db | Tx = getDb()) {
  const zones = await db.select().from(waterZones).orderBy(asc(waterZones.code));
  const routes = await db.select().from(waterRoutes).orderBy(asc(waterRoutes.code));
  const accounts = await db
    .select({ account: waterAccounts, customer: waterCustomers })
    .from(waterAccounts)
    .innerJoin(waterCustomers, eq(waterCustomers.id, waterAccounts.customerId))
    .orderBy(asc(waterAccounts.sequenceNo), asc(waterAccounts.accountNo));
  const meters = await currentMeters(accounts.map((a) => a.account.id), db);
  return zones.map((z) => ({
    ...z,
    routes: routes
      .filter((r) => r.zoneId === z.id)
      .map((r) => ({
        ...r,
        accounts: accounts
          .filter((a) => a.account.routeId === r.id)
          .map((a) => ({
            id: a.account.id,
            accountNo: a.account.accountNo,
            sequenceNo: a.account.sequenceNo,
            status: a.account.status,
            classification: a.account.classification,
            serviceAddress: a.account.serviceAddress,
            customerName: customerName(a.customer),
            meterSerial: meters.get(a.account.id)?.serialNo ?? null,
          })),
      })),
  }));
}

export async function listRoutes(db: Db | Tx = getDb()) {
  return db.select({ id: waterRoutes.id, code: waterRoutes.code, name: waterRoutes.name }).from(waterRoutes).orderBy(asc(waterRoutes.code));
}

export async function listRateSchedules(db: Db | Tx = getDb()) {
  return db.select().from(waterRateSchedules).orderBy(asc(waterRateSchedules.classification), asc(waterRateSchedules.appliesTo), desc(waterRateSchedules.effectiveFrom));
}

export async function listFees(db: Db | Tx = getDb()) {
  return db.select().from(waterFees).orderBy(asc(waterFees.code));
}

/** Count of applications waiting for a decision (for page headers). */
export async function pendingApplicationCount(db: Db | Tx = getDb()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(waterApplications).where(sql`${waterApplications.status} IN ('APPLIED','INSPECTED')`);
  return r?.n ?? 0;
}
