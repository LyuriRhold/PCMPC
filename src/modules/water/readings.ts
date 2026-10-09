import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addDays, isBusinessDate, now, type BusinessDate } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { getSetting } from "@/modules/settings/service";
import { consumptionFor, estimateFrom, flagsFor, type MeterChange } from "./consumption";
import {
  waterAccounts,
  waterBillingExclusions,
  waterBillingPeriods,
  waterMeterInstallations,
  waterMeters,
  waterReadings,
  waterRoutes,
  waterZones,
  type BillingPeriod,
  type ReadingFlag,
  type WaterAccount,
  type WaterReading,
} from "./schema";
import { WaterError } from "./service";

/**
 * Billing periods, meter readings (office grid and mobile sync), estimates, flag review and
 * billing exclusions (PHASE-06 T6.3/T6.4). Consumption rules live in consumption.ts.
 */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function zoneOf(tx: Db | Tx, zoneId: number) {
  const [z] = await tx.select().from(waterZones).where(eq(waterZones.id, zoneId));
  if (!z) throw new WaterError("Zone not found");
  return z;
}

export async function periodLabel(p: Pick<BillingPeriod, "period" | "zoneId">, db: Db | Tx = getDb()): Promise<string> {
  return `${p.period} for ${(await zoneOf(db, p.zoneId)).code}`;
}

// ── Periods ──

export type OpenPeriodInput = { period: string; zoneId: number; readingFrom: BusinessDate; readingTo: BusinessDate; billDate: BusinessDate };

/** Opens a zone's monthly billing period; the due date is the bill date + water.due_days. */
export async function openPeriod(tx: Tx, input: OpenPeriodInput, actorId: string): Promise<BillingPeriod> {
  if (!PERIOD_RE.test(input.period)) throw new WaterError("The period must look like 2026-10");
  for (const d of [input.readingFrom, input.readingTo, input.billDate]) if (!isBusinessDate(d)) throw new WaterError("Enter valid dates");
  if (input.readingFrom > input.readingTo) throw new WaterError("Reading from can't be after reading to");
  if (input.billDate < input.readingTo) throw new WaterError("The bill date can't be before the last reading date");
  const zone = await zoneOf(tx, input.zoneId);
  const [dup] = await tx.select({ id: waterBillingPeriods.id }).from(waterBillingPeriods).where(and(eq(waterBillingPeriods.period, input.period), eq(waterBillingPeriods.zoneId, zone.id)));
  if (dup) throw new WaterError(`${input.period} is already open for ${zone.code}`);
  const dueDate = addDays(input.billDate, await getSetting("water.due_days", tx));
  const [p] = await tx
    .insert(waterBillingPeriods)
    .values({ period: input.period, zoneId: zone.id, readingFrom: input.readingFrom, readingTo: input.readingTo, billDate: input.billDate, dueDate, createdBy: actorId })
    .returning();
  if (!p) throw new Error("period insert returned no row");
  await audit(tx, { action: "water.period_open", entity: "water_billing_period", entityId: p.id, after: { period: p.period, zone: zone.code, billDate: p.billDate, dueDate }, userId: actorId });
  return p;
}

export async function lockPeriod(tx: Tx, periodId: string): Promise<BillingPeriod> {
  const [p] = await tx.select().from(waterBillingPeriods).where(eq(waterBillingPeriods.id, periodId)).for("update");
  if (!p) throw new WaterError("Billing period not found");
  return p;
}

async function assertReadable(tx: Tx, p: BillingPeriod) {
  if (p.status === "BILLED" || p.status === "CLOSED") throw new WaterError(`${await periodLabel(p, tx)} is already ${p.status === "BILLED" ? "billed" : "closed"}`);
}

/** Closes a billed period (no more final bills or memos are expected against it). */
export async function closePeriod(tx: Tx, periodId: string, actorId: string) {
  const p = await lockPeriod(tx, periodId);
  if (p.status !== "BILLED") throw new WaterError(`Only a billed period can be closed (${await periodLabel(p, tx)} is ${p.status})`);
  await tx.update(waterBillingPeriods).set({ status: "CLOSED" }).where(eq(waterBillingPeriods.id, p.id));
  await audit(tx, { action: "water.period_close", entity: "water_billing_period", entityId: p.id, after: { period: p.period }, userId: actorId });
}

/** OPEN → READING on the first reading; READING → REVIEW once every billable account has one. */
async function advancePeriod(tx: Tx, p: BillingPeriod) {
  if (p.status === "OPEN") await tx.update(waterBillingPeriods).set({ status: "READING" }).where(eq(waterBillingPeriods.id, p.id));
  if (p.status === "OPEN" || p.status === "READING") {
    const unread = await unreadAccounts(tx, p);
    if (unread.length === 0) await tx.update(waterBillingPeriods).set({ status: "REVIEW" }).where(eq(waterBillingPeriods.id, p.id));
  }
}

// ── Accounts of a period ──

/** ACTIVE accounts on the zone's routes (and DISCONNECTED ones if water.bill_disconnected_accounts). */
export async function zoneAccounts(db: Db | Tx, zoneId: number): Promise<WaterAccount[]> {
  const statuses: Array<WaterAccount["status"]> = (await getSetting("water.bill_disconnected_accounts", db)) ? ["ACTIVE", "DISCONNECTED"] : ["ACTIVE"];
  const rows = await db
    .select({ account: waterAccounts })
    .from(waterAccounts)
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(and(eq(waterRoutes.zoneId, zoneId), inArray(waterAccounts.status, statuses)))
    .orderBy(asc(waterRoutes.code), asc(waterAccounts.sequenceNo));
  return rows.map((r) => r.account);
}

export async function unreadAccounts(db: Db | Tx, p: BillingPeriod) {
  const accounts = await zoneAccounts(db, p.zoneId);
  const readings = await db.select({ accountId: waterReadings.accountId }).from(waterReadings).where(eq(waterReadings.periodId, p.id));
  const excluded = await db.select({ accountId: waterBillingExclusions.accountId }).from(waterBillingExclusions).where(eq(waterBillingExclusions.periodId, p.id));
  const done = new Set([...readings, ...excluded].map((r) => r.accountId));
  return accounts.filter((a) => !done.has(a.id));
}

// ── Reading context ──

export type ReadingContext = {
  account: WaterAccount;
  meter: { id: string; serialNo: string; digits: number };
  /** Last actual reading (or the first meter's initial reading). */
  previous: number;
  changes: MeterChange[];
  estimatedSince: number;
  /** Recent actual consumption, newest first. */
  history: number[];
};

/** Everything needed to compute a reading for `account` in `period`, from earlier periods only. */
export async function readingContext(db: Db | Tx, account: WaterAccount, period: Pick<BillingPeriod, "period">): Promise<ReadingContext> {
  const installs = await db
    .select({ inst: waterMeterInstallations, serialNo: waterMeters.serialNo, digits: waterMeters.digits })
    .from(waterMeterInstallations)
    .innerJoin(waterMeters, eq(waterMeters.id, waterMeterInstallations.meterId))
    .where(eq(waterMeterInstallations.accountId, account.id))
    .orderBy(asc(waterMeterInstallations.installedAt), asc(waterMeterInstallations.createdAt));
  const current = installs.at(-1);
  if (!current || current.inst.removedAt !== null) throw new WaterError(`${account.accountNo} has no installed meter`);

  const prior = await db
    .select({ r: waterReadings })
    .from(waterReadings)
    .innerJoin(waterBillingPeriods, eq(waterBillingPeriods.id, waterReadings.periodId))
    .where(and(eq(waterReadings.accountId, account.id), lt(waterBillingPeriods.period, period.period), ne(waterReadings.status, "REJECTED")))
    .orderBy(desc(waterBillingPeriods.period));

  const baseIdx = prior.findIndex((p) => p.r.presentReading !== null);
  const base = baseIdx >= 0 ? prior[baseIdx]!.r : null;
  const estimatedSince = prior.slice(0, baseIdx >= 0 ? baseIdx : prior.length).reduce((s, p) => s + (p.r.type === "ESTIMATED" ? p.r.consumption : 0), 0);

  // The installation the base reading was taken on; meter changes chain from there to now.
  let fromIdx = 0;
  let previous = installs[0]!.inst.initialReading;
  if (base) {
    const idx = installs.findLastIndex((i) => i.inst.meterId === base.meterId);
    fromIdx = Math.max(0, idx);
    previous = base.presentReading ?? 0;
  }
  const changes: MeterChange[] = [];
  for (let i = fromIdx; i < installs.length - 1; i++) {
    changes.push({ oldFinal: installs[i]!.inst.finalReading ?? 0, newInitial: installs[i + 1]!.inst.initialReading });
  }

  const months = (await getSetting("water.estimate_basis", db)).months;
  const history = prior
    .filter((p) => p.r.type !== "ESTIMATED" && p.r.status === "APPROVED")
    .slice(0, months)
    .map((p) => p.r.consumption);

  return { account, meter: { id: current.inst.meterId, serialNo: current.serialNo, digits: current.digits }, previous, changes, estimatedSince, history };
}

async function lockAccountForPeriod(tx: Tx, accountId: string, p: BillingPeriod): Promise<WaterAccount> {
  const [row] = await tx
    .select({ account: waterAccounts, zoneId: waterRoutes.zoneId })
    .from(waterAccounts)
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(eq(waterAccounts.id, accountId))
    .for("update", { of: waterAccounts });
  if (!row) throw new WaterError("Account not found");
  if (row.zoneId !== p.zoneId) throw new WaterError(`${row.account.accountNo} isn't in this period's zone`);
  return row.account;
}

async function flagRules(db: Db | Tx) {
  const [high, low] = await Promise.all([getSetting("water.high_factor", db), getSetting("water.low_flag", db)]);
  return { high: { factor: high.factor, minM3: high.minM3 }, low: { factor: low.factor, zero: low.zero } };
}

// ── Entering readings ──

export type ReadingInput = {
  periodId: string;
  accountId: string;
  presentReading: number;
  rollover: boolean;
  remarks: string | null;
  /** Set by the mobile app: the same uuid is stored once. */
  clientUuid?: string | null;
  readAt?: Date;
};

export type ReadingOutcome = WaterReading & { duplicate: boolean };

/**
 * Records an actual (or meter-change) reading. Office entry replaces an unbilled reading of the
 * same period; a mobile sync never overwrites (dedupe by client uuid, then by period + account).
 * Flagged readings wait for approval; the rest are approved at once.
 */
export async function enterReading(tx: Tx, input: ReadingInput, actorId: string, source: "OFFICE" | "MOBILE"): Promise<ReadingOutcome> {
  if (input.clientUuid) {
    const [same] = await tx.select().from(waterReadings).where(eq(waterReadings.clientUuid, input.clientUuid));
    if (same) return { ...same, duplicate: true };
  }
  const p = await lockPeriod(tx, input.periodId);
  await assertReadable(tx, p);
  const account = await lockAccountForPeriod(tx, input.accountId, p);
  if (account.status !== "ACTIVE" && account.status !== "DISCONNECTED") throw new WaterError(`${account.accountNo} is ${account.status}`);
  const [existing] = await tx.select().from(waterReadings).where(and(eq(waterReadings.periodId, p.id), eq(waterReadings.accountId, account.id)));
  if (existing && source === "MOBILE") return { ...existing, duplicate: true };

  const ctx = await readingContext(tx, account, p);
  const result = consumptionFor({
    previous: ctx.previous,
    present: input.presentReading,
    digits: ctx.meter.digits,
    rollover: input.rollover,
    changes: ctx.changes,
    estimatedSince: ctx.estimatedSince,
  });
  const flags = flagsFor({ consumption: result.consumption, history: ctx.history, rollover: input.rollover }, await flagRules(tx));
  if (result.overEstimated > 0 && !flags.includes("ZERO")) flags.push("LOW");
  const values = {
    meterId: ctx.meter.id,
    previousReading: ctx.changes.length ? ctx.changes.at(-1)!.newInitial : ctx.previous,
    presentReading: input.presentReading,
    consumption: result.consumption,
    type: result.type,
    rollover: input.rollover,
    flags,
    status: flags.length ? ("ENTERED" as const) : ("APPROVED" as const),
    readerId: actorId,
    readAt: input.readAt ?? now(),
    clientUuid: input.clientUuid ?? null,
    remarks: input.remarks?.trim() || null,
    approvedBy: null,
    approvedAt: null,
  };
  // For a meter change the bill shows the new meter's initial reading as "previous".
  const remarks = ctx.changes.length && !values.remarks ? `Meter change: previous ${ctx.previous} on the old meter` : values.remarks;
  let row: WaterReading | undefined;
  if (existing) {
    [row] = await tx.update(waterReadings).set({ ...values, remarks }).where(eq(waterReadings.id, existing.id)).returning();
  } else {
    [row] = await tx.insert(waterReadings).values({ ...values, remarks, periodId: p.id, accountId: account.id, createdBy: actorId }).returning();
  }
  if (!row) throw new Error("reading write returned no row");
  await advancePeriod(tx, p);
  await audit(tx, {
    action: existing ? "water.reading_reenter" : "water.reading_enter",
    entity: "water_reading",
    entityId: row.id,
    before: existing ? { present: existing.presentReading, consumption: existing.consumption, status: existing.status } : undefined,
    after: { account: account.accountNo, present: row.presentReading, consumption: row.consumption, flags: row.flags, source },
    userId: actorId,
  });
  return { ...row, duplicate: false };
}

/** Records an estimated reading (meter inaccessible): the average of the recent actual months. */
export async function enterEstimate(tx: Tx, input: { periodId: string; accountId: string; reason: string }, actorId: string): Promise<WaterReading> {
  if (!input.reason.trim()) throw new WaterError("Say why the meter couldn't be read");
  const p = await lockPeriod(tx, input.periodId);
  await assertReadable(tx, p);
  const account = await lockAccountForPeriod(tx, input.accountId, p);
  if (account.status !== "ACTIVE" && account.status !== "DISCONNECTED") throw new WaterError(`${account.accountNo} is ${account.status}`);
  const ctx = await readingContext(tx, account, p);
  if (ctx.history.length === 0) throw new WaterError(`${account.accountNo} has no actual readings to estimate from`);
  const m3 = estimateFrom(ctx.history);
  const values = {
    meterId: ctx.meter.id,
    previousReading: ctx.previous,
    presentReading: null,
    consumption: m3,
    type: "ESTIMATED" as const,
    rollover: false,
    flags: [] as ReadingFlag[],
    status: "APPROVED" as const,
    readerId: actorId,
    readAt: now(),
    clientUuid: null,
    remarks: input.reason.trim(),
    approvedBy: actorId,
    approvedAt: now(),
  };
  const [existing] = await tx.select().from(waterReadings).where(and(eq(waterReadings.periodId, p.id), eq(waterReadings.accountId, account.id)));
  const [row] = existing
    ? await tx.update(waterReadings).set(values).where(eq(waterReadings.id, existing.id)).returning()
    : await tx.insert(waterReadings).values({ ...values, periodId: p.id, accountId: account.id, createdBy: actorId }).returning();
  if (!row) throw new Error("estimate write returned no row");
  await advancePeriod(tx, p);
  await audit(tx, { action: "water.reading_estimate", entity: "water_reading", entityId: row.id, after: { account: account.accountNo, consumption: m3, reason: values.remarks }, userId: actorId });
  return row;
}

async function lockReading(tx: Tx, readingId: string) {
  const [r] = await tx.select().from(waterReadings).where(eq(waterReadings.id, readingId)).for("update");
  if (!r) throw new WaterError("Reading not found");
  const p = await lockPeriod(tx, r.periodId);
  await assertReadable(tx, p);
  return { r, p };
}

/** Approves a flagged reading so it can be billed. */
export async function approveReading(tx: Tx, readingId: string, actorId: string): Promise<WaterReading> {
  const { r, p } = await lockReading(tx, readingId);
  if (r.status !== "ENTERED") throw new WaterError(`This reading is already ${r.status}`);
  const [row] = await tx.update(waterReadings).set({ status: "APPROVED", approvedBy: actorId, approvedAt: now() }).where(eq(waterReadings.id, r.id)).returning();
  if (!row) throw new Error("reading update returned no row");
  await advancePeriod(tx, p);
  await audit(tx, { action: "water.reading_approve", entity: "water_reading", entityId: r.id, after: { consumption: r.consumption, flags: r.flags }, userId: actorId });
  return row;
}

/** Rejects a flagged reading; the meter is re-read and the reading entered again. */
export async function rejectReading(tx: Tx, readingId: string, reason: string, actorId: string): Promise<void> {
  const { r } = await lockReading(tx, readingId);
  if (r.status !== "ENTERED") throw new WaterError(`This reading is already ${r.status}`);
  if (!reason.trim()) throw new WaterError("A reason is required");
  await tx.update(waterReadings).set({ status: "REJECTED", remarks: reason.trim() }).where(eq(waterReadings.id, r.id));
  await audit(tx, { action: "water.reading_reject", entity: "water_reading", entityId: r.id, after: { reason: reason.trim() }, userId: actorId });
}

/** Leaves an account out of this period's billing run, with the reason (approved by the actor). */
export async function excludeAccount(tx: Tx, input: { periodId: string; accountId: string; reason: string }, actorId: string) {
  const p = await lockPeriod(tx, input.periodId);
  await assertReadable(tx, p);
  const account = await lockAccountForPeriod(tx, input.accountId, p);
  if (!input.reason.trim()) throw new WaterError("A reason is required");
  const [reading] = await tx.select({ id: waterReadings.id }).from(waterReadings).where(and(eq(waterReadings.periodId, p.id), eq(waterReadings.accountId, account.id)));
  if (reading) throw new WaterError(`${account.accountNo} already has a reading for this period`);
  await tx
    .insert(waterBillingExclusions)
    .values({ periodId: p.id, accountId: account.id, reason: input.reason.trim(), approvedBy: actorId, createdBy: actorId })
    .onConflictDoNothing({ target: [waterBillingExclusions.periodId, waterBillingExclusions.accountId] });
  await advancePeriod(tx, p);
  await audit(tx, { action: "water.billing_exclude", entity: "water_account", entityId: account.id, after: { period: p.period, reason: input.reason.trim() }, userId: actorId });
}

// ── Readers and routes ──

/** Assigns a meter reader to a route (null clears it). Readers see only their routes. */
export async function assignReader(tx: Tx, routeId: string, readerId: string | null, actorId: string) {
  const [r] = await tx.select().from(waterRoutes).where(eq(waterRoutes.id, routeId)).for("update");
  if (!r) throw new WaterError("Route not found");
  if (readerId) {
    const [u] = await tx.select({ roleCode: users.roleCode, isActive: users.isActive }).from(users).where(eq(users.id, readerId));
    if (!u?.isActive) throw new WaterError("Reader not found");
    if (u.roleCode !== "METER_READER") throw new WaterError("Only meter readers can be assigned to a route");
  }
  await tx.update(waterRoutes).set({ assignedReaderId: readerId }).where(eq(waterRoutes.id, r.id));
  await audit(tx, { action: "water.route_reader", entity: "water_route", entityId: r.id, before: { reader: r.assignedReaderId }, after: { reader: readerId }, userId: actorId });
}

/** Whether `readerId` is assigned to the route of `accountId`. */
export async function readerCanRead(db: Db | Tx, readerId: string, accountId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: waterAccounts.id })
    .from(waterAccounts)
    .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
    .where(and(eq(waterAccounts.id, accountId), eq(waterRoutes.assignedReaderId, readerId)));
  return !!r;
}

