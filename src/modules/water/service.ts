import { and, asc, eq, gte, inArray, lte, max, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser } from "@/lib/auth-guard";
import { businessToday, now, type BusinessDate } from "@/lib/dates";
import { normalizeName } from "@/lib/names";
import { next as nextNumber } from "@/lib/numbering";
import { receiptItems, receipts } from "@/modules/cashiering/schema";
import { onMemberStatusChange } from "@/modules/members/hooks";
import { members } from "@/modules/members/schema";
import {
  waterAccountHistory,
  waterAccounts,
  waterApplications,
  waterCustomers,
  waterFees,
  waterMeterInstallations,
  waterMeters,
  waterRoutes,
  waterSeniorEligibility,
  waterZones,
  type Classification,
  type MeterStatus,
  type WaterAccount,
  type WaterApplication,
  type WaterCustomer,
} from "./schema";

/** A water rule was broken; the message is safe to show. */
export class WaterError extends Error {
  override name = "WaterError";
}

export function customerName(c: Pick<WaterCustomer, "businessName" | "lastName" | "firstName" | "middleName">): string {
  if (c.businessName) return c.businessName;
  return `${c.lastName}, ${c.firstName}${c.middleName ? ` ${c.middleName}` : ""}`;
}

async function history(tx: Tx, accountId: string, event: string, fromValue: string | null, toValue: string | null, ref: string | null, actorId: string | null) {
  await tx.insert(waterAccountHistory).values({ accountId, event, fromValue, toValue, ref, at: now(), by: actorId, createdBy: actorId });
}

// ── Customers (T5.2) ────────────────────────────────────────────────────────────────────────

export type CustomerInput = {
  type: "MEMBER" | "NON_MEMBER";
  memberId: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  businessName: string | null;
  address: string;
  mobile: string | null;
  email: string | null;
  validIdType: string | null;
  validIdNo: string | null;
  privacyConsent: boolean;
  remarks: string | null;
};

const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/**
 * Registers a water customer. A MEMBER customer is linked to an approved member (name, address
 * and mobile default from the member record); each member has at most one customer record.
 * Non-members are checked for duplicates on normalized name + address.
 */
export async function createCustomer(tx: Tx, input: CustomerInput, actorId: string): Promise<WaterCustomer> {
  let lastName = blank(input.lastName);
  let firstName = blank(input.firstName);
  let middleName = blank(input.middleName);
  const businessName = input.type === "MEMBER" ? null : blank(input.businessName);
  let address = blank(input.address);
  let mobile = blank(input.mobile);

  if (input.type === "MEMBER") {
    if (!input.memberId) throw new WaterError("Choose the member");
    const [m] = await tx.select().from(members).where(eq(members.id, input.memberId));
    if (!m?.memberNo) throw new WaterError("Only approved members can be member customers");
    if (m.status !== "ACTIVE" && m.status !== "INACTIVE") throw new WaterError(`Member ${m.memberNo} is ${m.status}`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`water-customer-member:${m.id}`}))`);
    const [existing] = await tx.select({ id: waterCustomers.id }).from(waterCustomers).where(and(eq(waterCustomers.memberId, m.id), eq(waterCustomers.type, "MEMBER")));
    if (existing) throw new WaterError(`Customer already exists for ${m.memberNo}`);
    lastName = m.lastName;
    firstName = m.firstName;
    middleName = m.middleName;
    address = address ?? [m.addrStreet, m.addrPurok, m.addrBarangay, m.addrMunicipality, m.addrProvince].filter(Boolean).join(", ");
    mobile = mobile ?? m.mobile;
  } else if (!businessName && !(lastName && firstName)) {
    throw new WaterError("Enter the customer's last and first name, or a business name");
  }
  if (!address) throw new WaterError("Address is required");

  const displayName = businessName ?? `${lastName} ${firstName}`;
  const nameKey = `${normalizeName(displayName)}|${normalizeName(address)}`;
  if (input.type === "NON_MEMBER") {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`water-customer:${nameKey}`}))`);
    const [dup] = await tx.select({ customerNo: waterCustomers.customerNo }).from(waterCustomers).where(eq(waterCustomers.nameKey, nameKey));
    if (dup) throw new WaterError(`Possible duplicate of ${dup.customerNo} (same name and address)`);
  }

  const customerNo = await nextNumber("WC", tx);
  const at = now();
  const [c] = await tx
    .insert(waterCustomers)
    .values({
      customerNo,
      type: input.type,
      memberId: input.type === "MEMBER" ? input.memberId : null,
      lastName,
      firstName,
      middleName,
      businessName,
      nameKey,
      searchText: normalizeName([customerNo, businessName, lastName, firstName, middleName].filter(Boolean).join(" ")),
      address,
      mobile,
      email: blank(input.email),
      validIdType: blank(input.validIdType),
      validIdNo: blank(input.validIdNo),
      privacyConsentAt: input.privacyConsent ? at : null,
      remarks: blank(input.remarks),
      createdBy: actorId,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (!c) throw new Error("customer insert returned no row");
  await audit(tx, { action: "water.customer_create", entity: "water_customer", entityId: c.id, after: { customerNo, type: c.type, name: customerName(c) }, userId: actorId });
  return c;
}

// A terminated or deceased member's customer record continues as NON_MEMBER (CONFIRM, Q-05.6).
onMemberStatusChange("water", async (tx, change) => {
  if (change.to !== "TERMINATED" && change.to !== "DECEASED") return;
  const updated = await tx
    .update(waterCustomers)
    .set({ type: "NON_MEMBER", updatedAt: now() })
    .where(and(eq(waterCustomers.memberId, change.memberId), eq(waterCustomers.type, "MEMBER")))
    .returning({ id: waterCustomers.id, customerNo: waterCustomers.customerNo });
  for (const c of updated) {
    await audit(tx, { action: "water.customer_type_change", entity: "water_customer", entityId: c.id, before: { type: "MEMBER" }, after: { type: "NON_MEMBER", reason: `member ${change.to}` }, userId: change.actorId });
  }
});

// ── Applications → accounts (T5.3) ──────────────────────────────────────────────────────────

async function defaultRouteId(tx: Tx): Promise<string> {
  const [r] = await tx.select({ id: waterRoutes.id }).from(waterRoutes).orderBy(asc(waterRoutes.code)).limit(1);
  if (!r) throw new WaterError("Set up a water zone and route first");
  return r.id;
}

async function lockApplication(tx: Tx, id: string): Promise<WaterApplication> {
  const [a] = await tx.select().from(waterApplications).where(eq(waterApplications.id, id)).for("update");
  if (!a) throw new WaterError("Application not found");
  return a;
}

export type ApplicationInput = { customerId: string; classification: Classification; serviceAddress: string; routeId: string | null };

export async function createApplication(tx: Tx, input: ApplicationInput, encoderId: string): Promise<WaterApplication> {
  const [c] = await tx.select({ id: waterCustomers.id }).from(waterCustomers).where(eq(waterCustomers.id, input.customerId));
  if (!c) throw new WaterError("Customer not found");
  if (!input.serviceAddress.trim()) throw new WaterError("Service address is required");
  const appNo = await nextNumber("WAPP", tx);
  const [a] = await tx
    .insert(waterApplications)
    .values({
      appNo,
      customerId: input.customerId,
      classification: input.classification,
      serviceAddress: input.serviceAddress.trim(),
      routeId: input.routeId,
      encodedBy: encoderId,
      createdBy: encoderId,
    })
    .returning();
  if (!a) throw new Error("application insert returned no row");
  await audit(tx, { action: "water.application_create", entity: "water_application", entityId: a.id, after: { appNo, classification: a.classification }, userId: encoderId });
  return a;
}

export async function inspectApplication(tx: Tx, applicationId: string, notes: string, actorId: string): Promise<WaterApplication> {
  const a = await lockApplication(tx, applicationId);
  if (a.status !== "APPLIED") throw new WaterError(`${a.appNo} is already ${a.status}`);
  const [after] = await tx
    .update(waterApplications)
    .set({ status: "INSPECTED", inspectionNotes: notes.trim() || null, inspectedBy: actorId, inspectedAt: now() })
    .where(eq(waterApplications.id, a.id))
    .returning();
  if (!after) throw new Error("application update returned no row");
  await audit(tx, { action: "water.application_inspect", entity: "water_application", entityId: a.id, after: { notes: after.inspectionNotes }, userId: actorId });
  return after;
}

/**
 * Approves an application (the approver can't be the encoder) and opens its service account as
 * PENDING, at the end of its route's reading order. Fees are paid next, then the meter is installed.
 */
export async function approveApplication(tx: Tx, applicationId: string, approverId: string): Promise<{ application: WaterApplication; account: WaterAccount }> {
  const a = await lockApplication(tx, applicationId);
  if (a.status !== "APPLIED" && a.status !== "INSPECTED") throw new WaterError(`${a.appNo} is already ${a.status}`);
  assertNotSameUser(a.encodedBy, approverId);
  const routeId = a.routeId ?? (await defaultRouteId(tx));
  const [seq] = await tx.select({ n: max(waterAccounts.sequenceNo) }).from(waterAccounts).where(eq(waterAccounts.routeId, routeId));
  const accountNo = await nextNumber("WA", tx);
  const [account] = await tx
    .insert(waterAccounts)
    .values({
      accountNo,
      customerId: a.customerId,
      classification: a.classification,
      routeId,
      sequenceNo: (seq?.n ?? 0) + 1,
      serviceAddress: a.serviceAddress,
      applicationId: a.id,
      createdBy: approverId,
    })
    .returning();
  if (!account) throw new Error("account insert returned no row");
  const [application] = await tx
    .update(waterApplications)
    .set({ status: "APPROVED", approvedBy: approverId, approvedAt: now(), accountId: account.id, routeId })
    .where(eq(waterApplications.id, a.id))
    .returning();
  if (!application) throw new Error("application update returned no row");
  await history(tx, account.id, "CREATED", null, "PENDING", a.appNo, approverId);
  await audit(tx, { action: "water.application_approve", entity: "water_application", entityId: a.id, after: { appNo: a.appNo, accountNo }, userId: approverId });
  return { application, account };
}

export async function rejectApplication(tx: Tx, applicationId: string, reason: string, approverId: string): Promise<WaterApplication> {
  const a = await lockApplication(tx, applicationId);
  if (a.status !== "APPLIED" && a.status !== "INSPECTED") throw new WaterError(`${a.appNo} is already ${a.status}`);
  if (!reason.trim()) throw new WaterError("A reason is required");
  const [after] = await tx.update(waterApplications).set({ status: "REJECTED", rejectedReason: reason.trim() }).where(eq(waterApplications.id, a.id)).returning();
  if (!after) throw new Error("application update returned no row");
  await audit(tx, { action: "water.application_reject", entity: "water_application", entityId: a.id, after: { reason: reason.trim() }, userId: approverId });
  return after;
}

// ── Fees collected at the teller (T5.6 uses these) ──────────────────────────────────────────

export async function feeByCode(code: string, db: Db | Tx = getDb()) {
  const [f] = await db.select().from(waterFees).where(and(eq(waterFees.code, code), eq(waterFees.isActive, true)));
  return f ?? null;
}

/** Whether a VALID receipt already collected `itemType` for this application. */
export async function feePaid(itemType: string, applicationId: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [r] = await db
    .select({ id: receiptItems.id })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(receiptItems.type, itemType), eq(receiptItems.refId, applicationId), eq(receipts.status, "VALID")))
    .limit(1);
  return !!r;
}

// ── Meters, installation, replacement, activation (T5.3, T5.4) ──────────────────────────────

export type MeterInput = { serialNo: string; brand: string | null; size: string | null; digits: number };

export async function addMeter(tx: Tx, input: MeterInput, actorId: string) {
  const serialNo = input.serialNo.trim().toUpperCase();
  if (!serialNo) throw new WaterError("Serial no. is required");
  if (!Number.isInteger(input.digits) || input.digits < 3 || input.digits > 9) throw new WaterError("Digits must be between 3 and 9");
  const [dup] = await tx.select({ id: waterMeters.id }).from(waterMeters).where(eq(waterMeters.serialNo, serialNo));
  if (dup) throw new WaterError(`Meter ${serialNo} is already in the inventory`);
  const [m] = await tx.insert(waterMeters).values({ serialNo, brand: blank(input.brand), size: blank(input.size), digits: input.digits, createdBy: actorId }).returning();
  if (!m) throw new Error("meter insert returned no row");
  await audit(tx, { action: "water.meter_add", entity: "water_meter", entityId: m.id, after: { serialNo, digits: m.digits }, userId: actorId });
  return m;
}

/** Marks an uninstalled meter DEFECTIVE, RETIRED or back IN_STOCK. Installed meters change only through replacement. */
export async function setMeterStatus(tx: Tx, meterId: string, status: Exclude<MeterStatus, "INSTALLED">, actorId: string) {
  const [m] = await tx.select().from(waterMeters).where(eq(waterMeters.id, meterId)).for("update");
  if (!m) throw new WaterError("Meter not found");
  if (m.status === "INSTALLED") throw new WaterError(`Meter ${m.serialNo} is installed; replace it at its account first`);
  await tx.update(waterMeters).set({ status }).where(eq(waterMeters.id, meterId));
  await audit(tx, { action: "water.meter_status", entity: "water_meter", entityId: meterId, before: { status: m.status }, after: { status }, userId: actorId });
}

async function meterForInstall(tx: Tx, serial: string) {
  const serialNo = serial.trim().toUpperCase();
  const [m] = await tx.select().from(waterMeters).where(eq(waterMeters.serialNo, serialNo)).for("update");
  if (!m) throw new WaterError(`Meter ${serialNo} is not in the inventory`);
  if (m.status === "INSTALLED") {
    const [at] = await tx
      .select({ accountNo: waterAccounts.accountNo })
      .from(waterMeterInstallations)
      .innerJoin(waterAccounts, eq(waterAccounts.id, waterMeterInstallations.accountId))
      .where(and(eq(waterMeterInstallations.meterId, m.id), sql`${waterMeterInstallations.removedAt} IS NULL`));
    throw new WaterError(`Meter ${serialNo} is already installed${at ? ` at ${at.accountNo}` : ""}`);
  }
  if (m.status !== "IN_STOCK") throw new WaterError(`Meter ${serialNo} is ${m.status}`);
  return m;
}

function assertReading(reading: number, digits: number, what: string) {
  if (!Number.isInteger(reading) || reading < 0 || reading >= 10 ** digits) throw new WaterError(`${what} must be a whole number from 0 to ${10 ** digits - 1}`);
}

async function lockAccount(tx: Tx, accountId: string): Promise<WaterAccount> {
  const [a] = await tx.select().from(waterAccounts).where(eq(waterAccounts.id, accountId)).for("update");
  if (!a) throw new WaterError("Account not found");
  return a;
}

/**
 * Installs the first meter of an approved application (after its connection fee and meter
 * deposit were paid) with an initial reading, and activates the account.
 */
export async function installMeter(tx: Tx, input: { applicationId: string; meterSerial: string; initialReading: number }, actorId: string) {
  const app = await lockApplication(tx, input.applicationId);
  if (app.status !== "APPROVED" || !app.accountId) throw new WaterError(app.status === "INSTALLED" ? `${app.appNo} already has a meter` : `${app.appNo} isn't approved yet`);
  if (!(await feePaid("WATER_CONNECTION_FEE", app.id, tx)) || !(await feePaid("METER_DEPOSIT", app.id, tx))) {
    throw new WaterError("Collect the connection fee and the meter deposit at the teller first");
  }
  const account = await lockAccount(tx, app.accountId);
  if (account.status !== "PENDING") throw new WaterError(`${account.accountNo} is already ${account.status}`);
  const meter = await meterForInstall(tx, input.meterSerial);
  assertReading(input.initialReading, meter.digits, "The initial reading");
  const today = businessToday();
  await tx.insert(waterMeterInstallations).values({ accountId: account.id, meterId: meter.id, installedAt: today, initialReading: input.initialReading, reason: "New connection", createdBy: actorId });
  await tx.update(waterMeters).set({ status: "INSTALLED" }).where(eq(waterMeters.id, meter.id));
  await tx.update(waterApplications).set({ status: "INSTALLED", installedAt: today }).where(eq(waterApplications.id, app.id));
  await tx.update(waterAccounts).set({ status: "ACTIVE", connectedAt: today, updatedAt: now() }).where(eq(waterAccounts.id, account.id));
  await history(tx, account.id, "METER_INSTALLED", null, meter.serialNo, `initial reading ${input.initialReading}`, actorId);
  await history(tx, account.id, "STATUS", "PENDING", "ACTIVE", app.appNo, actorId);
  await audit(tx, { action: "water.meter_install", entity: "water_account", entityId: account.id, after: { accountNo: account.accountNo, meter: meter.serialNo, initialReading: input.initialReading }, userId: actorId });
  return { accountNo: account.accountNo };
}

/** Activates a PENDING account. An account can't be ACTIVE without an installed meter. */
export async function activateAccount(tx: Tx, accountId: string, actorId: string): Promise<WaterAccount> {
  const a = await lockAccount(tx, accountId);
  if (a.status !== "PENDING") throw new WaterError(`${a.accountNo} is ${a.status}`);
  const [inst] = await tx.select().from(waterMeterInstallations).where(and(eq(waterMeterInstallations.accountId, a.id), sql`${waterMeterInstallations.removedAt} IS NULL`));
  if (!inst) throw new WaterError(`${a.accountNo} has no installed meter; install one with an initial reading first`);
  const [after] = await tx.update(waterAccounts).set({ status: "ACTIVE", connectedAt: a.connectedAt ?? businessToday(), updatedAt: now() }).where(eq(waterAccounts.id, a.id)).returning();
  if (!after) throw new Error("account update returned no row");
  await history(tx, a.id, "STATUS", a.status, "ACTIVE", null, actorId);
  await audit(tx, { action: "water.account_activate", entity: "water_account", entityId: a.id, after: { accountNo: a.accountNo }, userId: actorId });
  return after;
}

export type ReplaceInput = {
  accountId: string;
  oldFinalReading: number;
  oldMeterStatus: Exclude<MeterStatus, "INSTALLED">;
  newMeterSerial: string;
  newInitialReading: number;
  reason: string;
};

/** Replaces an account's meter, keeping the old meter's final reading and the new one's initial reading (Phase 06 bills both). */
export async function replaceMeter(tx: Tx, input: ReplaceInput, actorId: string): Promise<void> {
  const a = await lockAccount(tx, input.accountId);
  if (a.status !== "ACTIVE" && a.status !== "DISCONNECTED") throw new WaterError(`${a.accountNo} is ${a.status}`);
  if (!input.reason.trim()) throw new WaterError("A reason is required");
  const [current] = await tx
    .select({ inst: waterMeterInstallations, meter: waterMeters })
    .from(waterMeterInstallations)
    .innerJoin(waterMeters, eq(waterMeters.id, waterMeterInstallations.meterId))
    .where(and(eq(waterMeterInstallations.accountId, a.id), sql`${waterMeterInstallations.removedAt} IS NULL`))
    .for("update");
  if (!current) throw new WaterError(`${a.accountNo} has no installed meter`);
  assertReading(input.oldFinalReading, current.meter.digits, "The old meter's final reading");
  const next = await meterForInstall(tx, input.newMeterSerial);
  assertReading(input.newInitialReading, next.digits, "The new meter's initial reading");
  const today = businessToday();
  await tx.update(waterMeterInstallations).set({ removedAt: today, finalReading: input.oldFinalReading, reason: input.reason.trim() }).where(eq(waterMeterInstallations.id, current.inst.id));
  await tx.update(waterMeters).set({ status: input.oldMeterStatus }).where(eq(waterMeters.id, current.meter.id));
  await tx.insert(waterMeterInstallations).values({ accountId: a.id, meterId: next.id, installedAt: today, initialReading: input.newInitialReading, reason: input.reason.trim(), createdBy: actorId });
  await tx.update(waterMeters).set({ status: "INSTALLED" }).where(eq(waterMeters.id, next.id));
  await history(tx, a.id, "METER_REPLACED", `${current.meter.serialNo} (final ${input.oldFinalReading})`, `${next.serialNo} (initial ${input.newInitialReading})`, input.reason.trim(), actorId);
  await audit(tx, {
    action: "water.meter_replace",
    entity: "water_account",
    entityId: a.id,
    after: { old: current.meter.serialNo, oldFinal: input.oldFinalReading, oldStatus: input.oldMeterStatus, new: next.serialNo, newInitial: input.newInitialReading },
    userId: actorId,
  });
}

/** Moves an account to another customer (ownership transfer); the deposit stays with the account (Q-05.3). */
export async function transferAccount(tx: Tx, accountId: string, newCustomerId: string, reason: string, actorId: string): Promise<void> {
  const a = await lockAccount(tx, accountId);
  if (a.status === "CLOSED") throw new WaterError(`${a.accountNo} is closed`);
  if (a.customerId === newCustomerId) throw new WaterError("Choose a different customer");
  if (!reason.trim()) throw new WaterError("A reason is required");
  const rows = await tx.select().from(waterCustomers).where(inArray(waterCustomers.id, [a.customerId, newCustomerId]));
  const from = rows.find((r) => r.id === a.customerId);
  const to = rows.find((r) => r.id === newCustomerId);
  if (!to) throw new WaterError("New customer not found");
  await tx.update(waterAccounts).set({ customerId: newCustomerId, updatedAt: now() }).where(eq(waterAccounts.id, a.id));
  await history(tx, a.id, "TRANSFERRED", from?.customerNo ?? null, to.customerNo, reason.trim(), actorId);
  await audit(tx, { action: "water.account_transfer", entity: "water_account", entityId: a.id, after: { from: from?.customerNo, to: to.customerNo, reason: reason.trim() }, userId: actorId });
}

// ── Routes (T5.8 reading sequence) ──────────────────────────────────────────────────────────

/** Sets the reading order of a route; `accountIds` must list every account on the route once. */
export async function reorderRoute(tx: Tx, routeId: string, accountIds: string[], actorId: string): Promise<void> {
  const onRoute = await tx.select({ id: waterAccounts.id }).from(waterAccounts).where(eq(waterAccounts.routeId, routeId)).for("update");
  const ids = new Set(onRoute.map((r) => r.id));
  if (accountIds.length !== ids.size || new Set(accountIds).size !== accountIds.length || accountIds.some((id) => !ids.has(id))) {
    throw new WaterError("The new order must list every account on the route exactly once");
  }
  for (const [i, id] of accountIds.entries()) await tx.update(waterAccounts).set({ sequenceNo: i + 1 }).where(eq(waterAccounts.id, id));
  await audit(tx, { action: "water.route_reorder", entity: "water_route", entityId: routeId, after: { count: accountIds.length }, userId: actorId });
}

/** Moves an account to another route, at the end of that route's reading order. */
export async function moveAccountToRoute(tx: Tx, accountId: string, routeId: string, actorId: string): Promise<void> {
  const a = await lockAccount(tx, accountId);
  if (a.routeId === routeId) return;
  const [r] = await tx.select({ id: waterRoutes.id, code: waterRoutes.code }).from(waterRoutes).where(eq(waterRoutes.id, routeId));
  if (!r) throw new WaterError("Route not found");
  const [seq] = await tx.select({ n: max(waterAccounts.sequenceNo) }).from(waterAccounts).where(and(eq(waterAccounts.routeId, routeId), ne(waterAccounts.id, a.id)));
  await tx.update(waterAccounts).set({ routeId, sequenceNo: (seq?.n ?? 0) + 1, updatedAt: now() }).where(eq(waterAccounts.id, a.id));
  await history(tx, a.id, "ROUTE", null, r.code, null, actorId);
}

// ── Senior-citizen eligibility (T5.7) ───────────────────────────────────────────────────────

export type SeniorInput = { accountId: string; seniorName: string; oscaIdNo: string; validFrom: BusinessDate; validUntil: BusinessDate };

/** Records RA 9994 eligibility (CONFIRM) for a RESIDENTIAL account; Phase 06 applies the discount. */
export async function addSeniorEligibility(tx: Tx, input: SeniorInput, actorId: string) {
  const a = await lockAccount(tx, input.accountId);
  if (a.classification !== "RESIDENTIAL") throw new WaterError("The senior-citizen discount applies to RESIDENTIAL accounts only");
  if (!input.seniorName.trim() || !input.oscaIdNo.trim()) throw new WaterError("Enter the senior's name and OSCA ID no.");
  if (input.validUntil < input.validFrom) throw new WaterError("Valid until can't be before valid from");
  const [row] = await tx
    .insert(waterSeniorEligibility)
    .values({ accountId: a.id, seniorName: input.seniorName.trim(), oscaIdNo: input.oscaIdNo.trim(), validFrom: input.validFrom, validUntil: input.validUntil, createdBy: actorId })
    .returning();
  if (!row) throw new Error("eligibility insert returned no row");
  await history(tx, a.id, "SENIOR_ELIGIBILITY", null, `${input.validFrom} to ${input.validUntil}`, input.oscaIdNo.trim(), actorId);
  await audit(tx, { action: "water.senior_add", entity: "water_account", entityId: a.id, after: { seniorName: row.seniorName, validFrom: row.validFrom, validUntil: row.validUntil }, userId: actorId });
  return row;
}

/** Whether a RESIDENTIAL account has senior eligibility valid on the date. */
export async function isSeniorEligible(accountId: string, date: BusinessDate, db: Db | Tx = getDb()): Promise<boolean> {
  const [r] = await db
    .select({ id: waterSeniorEligibility.id })
    .from(waterSeniorEligibility)
    .innerJoin(waterAccounts, eq(waterAccounts.id, waterSeniorEligibility.accountId))
    .where(
      and(
        eq(waterSeniorEligibility.accountId, accountId),
        eq(waterAccounts.classification, "RESIDENTIAL"),
        lte(waterSeniorEligibility.validFrom, date),
        gte(waterSeniorEligibility.validUntil, date),
      ),
    )
    .limit(1);
  return !!r;
}

// ── Zones and routes (Phase 06: periods are per zone; readers are assigned per route) ──────

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

export async function addZone(tx: Tx, input: { code: string; name: string }, actorId: string) {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new WaterError("Zone code: letters, digits and dashes (up to 20)");
  if (!input.name.trim()) throw new WaterError("Zone name is required");
  const [dup] = await tx.select({ id: waterZones.id }).from(waterZones).where(eq(waterZones.code, code));
  if (dup) throw new WaterError(`Zone ${code} already exists`);
  const [z] = await tx.insert(waterZones).values({ code, name: input.name.trim(), createdBy: actorId }).returning();
  if (!z) throw new Error("zone insert returned no row");
  await audit(tx, { action: "water.zone_add", entity: "water_zone", entityId: String(z.id), after: { code, name: z.name }, userId: actorId });
  return z;
}

export async function addRoute(tx: Tx, input: { zoneId: number; code: string; name: string }, actorId: string) {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new WaterError("Route code: letters, digits and dashes (up to 20)");
  if (!input.name.trim()) throw new WaterError("Route name is required");
  const [zone] = await tx.select({ id: waterZones.id }).from(waterZones).where(eq(waterZones.id, input.zoneId));
  if (!zone) throw new WaterError("Zone not found");
  const [dup] = await tx.select({ id: waterRoutes.id }).from(waterRoutes).where(eq(waterRoutes.code, code));
  if (dup) throw new WaterError(`Route ${code} already exists`);
  const [r] = await tx.insert(waterRoutes).values({ zoneId: zone.id, code, name: input.name.trim(), createdBy: actorId }).returning();
  if (!r) throw new Error("route insert returned no row");
  await audit(tx, { action: "water.route_add", entity: "water_route", entityId: r.id, after: { code, name: r.name, zoneId: zone.id }, userId: actorId });
  return r;
}
