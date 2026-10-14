import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { addMonths, businessToday, monthEnd, type BusinessDate } from "@/lib/dates";
import { divide, format, type Money } from "@/lib/money";
import { periods } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { assetClasses, assetDepreciation, depreciationRuns, fixedAssets, type FixedAsset } from "./schema";

/**
 * The fixed-asset register and depreciation (PHASE-14 T14.3). Straight-line, monthly, from the
 * month the asset was acquired (CONFIRM Q-14.3): (cost − salvage) ÷ life in months, HALF-UP; the
 * last month takes whatever is left, so the asset ends exactly at its salvage value. One run per
 * month, posted on the month's last day: Dr Depreciation Expense / Cr Accumulated Depreciation of
 * each asset class. An asset already partly depreciated in the books before (or registered after
 * its months were run) comes in with its accumulated depreciation through a month; this system
 * depreciates it from the month after.
 */

/** A rule on assets, depreciation, bank reconciliation or closing was broken; the message is safe to show. */
export class AccountingError extends Error {
  override name = "AccountingError";
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const periodStart = (period: string): BusinessDate => `${period}-01`;
const periodOfDate = (d: BusinessDate) => d.slice(0, 7);
const prevPeriod = (period: string) => periodOfDate(addMonths(periodStart(period), -1));
const nextPeriod = (period: string) => periodOfDate(addMonths(periodStart(period), 1));

/** Register, void and depreciation runs take turns, so an asset can't slip in beside a run. */
const lockRegister = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('accounting.fixed-assets'))`);

async function latestRun(tx: Tx): Promise<string | null> {
  const [r] = await tx.select({ period: depreciationRuns.period }).from(depreciationRuns).orderBy(desc(depreciationRuns.period)).limit(1);
  return r?.period ?? null;
}
/** Months from `from` to `to` (YYYY-MM), counting both: 2026-12 → 2026-12 is 1. */
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;

export type AssetInput = {
  tag: string;
  description: string;
  classCode: string;
  acquisitionDate: BusinessDate;
  cost: Money;
  salvage: Money;
  lifeMonths: number;
  /** Accumulated depreciation brought forward, through `depreciatedThrough` (YYYY-MM). */
  openingAccumulated?: Money;
  depreciatedThrough?: string | null;
};

/** Adds an asset to the register (its purchase is posted by its DV or JV to the class's property and equipment account). */
export async function registerAsset(tx: Tx, input: AssetInput, actorId: string) {
  const tag = input.tag.trim().toUpperCase();
  const description = input.description.trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(tag)) throw new AccountingError("The asset tag uses letters, digits, dot, dash or underscore (up to 30)");
  if (!description) throw new AccountingError("Describe the asset");
  const [cls] = await tx.select().from(assetClasses).where(eq(assetClasses.code, input.classCode));
  if (!cls || !cls.isActive) throw new AccountingError("Choose an asset class");
  try {
    await accountIdFor(`accumulated_depreciation_${cls.code}`, tx);
  } catch {
    throw new AccountingError(`Map an account to accumulated_depreciation_${cls.code} first (Chart of accounts)`);
  }
  if (input.acquisitionDate > businessToday()) throw new AccountingError("The acquisition date can't be in the future");
  if (input.cost <= 0n) throw new AccountingError("The cost must be more than zero");
  if (input.salvage < 0n || input.salvage >= input.cost) throw new AccountingError("The salvage value is 0 or more and less than the cost");
  if (!Number.isSafeInteger(input.lifeMonths) || input.lifeMonths < 1 || input.lifeMonths > 600) throw new AccountingError("The useful life is 1 to 600 months");
  await lockRegister(tx);
  const [dup] = await tx.select({ id: fixedAssets.id }).from(fixedAssets).where(and(eq(fixedAssets.tag, tag), ne(fixedAssets.status, "VOID")));
  if (dup) throw new AccountingError(`Asset tag ${tag} is already used`);

  const acquired = periodOfDate(input.acquisitionDate);
  const opening = input.openingAccumulated ?? 0n;
  const through = input.depreciatedThrough || null;
  if (opening < 0n || opening > input.cost - input.salvage) throw new AccountingError("The accumulated depreciation brought forward is 0 up to the cost less the salvage value");
  if (opening > 0n && !through) throw new AccountingError("Enter the month the accumulated depreciation brought forward runs through");
  if (through && (!PERIOD_RE.test(through) || through < acquired || through > periodOfDate(businessToday()))) {
    throw new AccountingError("The accumulated depreciation runs through a month from the acquisition month up to this month");
  }
  const depreciateFrom = through ? nextPeriod(through) : acquired;
  // Months already run can't be caught up: bring the depreciation forward through the last run.
  const last = await latestRun(tx);
  if (last && depreciateFrom <= last) throw new AccountingError(`Depreciation is already run through ${last}: enter the accumulated depreciation through ${last}`);
  const [start] = await tx
    .select({ status: periods.status })
    .from(periods)
    .where(and(eq(periods.year, Number(depreciateFrom.slice(0, 4))), eq(periods.month, Number(depreciateFrom.slice(5, 7)))));
  if (start?.status === "CLOSED") throw new AccountingError(`${depreciateFrom} is closed: enter the accumulated depreciation through ${depreciateFrom}`);
  if (!start) {
    const [first] = await tx.select({ year: periods.year, month: periods.month }).from(periods).orderBy(asc(periods.year), asc(periods.month)).limit(1);
    const books = first ? `${first.year}-${String(first.month).padStart(2, "0")}` : null;
    if (books && depreciateFrom < books) throw new AccountingError(`The books start in ${books}: enter the accumulated depreciation through ${prevPeriod(books)}`);
  }

  const done = opening === input.cost - input.salvage;
  const [a] = await tx
    .insert(fixedAssets)
    .values({
      tag,
      description,
      classCode: cls.code,
      acquisitionDate: input.acquisitionDate,
      cost: input.cost,
      salvage: input.salvage,
      lifeMonths: input.lifeMonths,
      openingAccumulated: opening,
      depreciateFrom,
      accumulated: opening,
      status: done ? "FULLY_DEPRECIATED" : "ACTIVE",
      createdBy: actorId,
    })
    .returning();
  if (!a) throw new Error("asset insert returned no row");
  await audit(tx, {
    action: "fa.register",
    entity: "fixed_asset",
    entityId: a.id,
    after: { tag, class: cls.code, cost: format(input.cost), salvage: format(input.salvage), lifeMonths: input.lifeMonths, acquired: input.acquisitionDate, openingAccumulated: format(opening), depreciateFrom },
    userId: actorId,
  });
  return { id: a.id };
}

/** Voids a wrongly registered asset (its tag is free again); only before any depreciation was posted for it. */
export async function voidAsset(tx: Tx, input: { assetId: string; reason: string }, actorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new AccountingError("Enter why the asset is voided");
  await lockRegister(tx);
  const [a] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, input.assetId)).for("update");
  if (!a) throw new AccountingError("Asset not found");
  if (a.status === "VOID") throw new AccountingError(`${a.tag} is already voided`);
  const [posted] = await tx.select({ id: assetDepreciation.id }).from(assetDepreciation).where(eq(assetDepreciation.assetId, a.id)).limit(1);
  if (posted) throw new AccountingError(`${a.tag} already has depreciation posted; it can't be voided`);
  await tx.update(fixedAssets).set({ status: "VOID", voidReason: reason }).where(eq(fixedAssets.id, a.id));
  await audit(tx, { action: "fa.void", entity: "fixed_asset", entityId: a.id, before: { status: a.status }, after: { status: "VOID", reason }, userId: actorId });
}

/** One month's depreciation of an asset: the monthly amount, or what is left in its last month. */
export function monthlyDepreciation(asset: Pick<FixedAsset, "acquisitionDate" | "cost" | "salvage" | "lifeMonths" | "accumulated"> & { depreciateFrom?: string }, period: string): Money {
  const first = periodOfDate(asset.acquisitionDate);
  if (period < (asset.depreciateFrom ?? first)) return 0n;
  const left = asset.cost - asset.salvage - asset.accumulated;
  if (left <= 0n) return 0n;
  const monthly = divide(asset.cost - asset.salvage, BigInt(asset.lifeMonths));
  return monthsBetween(first, period) >= asset.lifeMonths || monthly >= left ? left : monthly;
}

/**
 * The month's depreciation run (once per month, in order): every active asset depreciated from this
 * month or before and not yet fully depreciated, one entry dated the month's last day.
 */
export async function runDepreciation(tx: Tx, input: { period: string }, actorId: string) {
  const period = input.period;
  if (!PERIOD_RE.test(period)) throw new AccountingError("Choose the month (YYYY-MM)");
  if (period > periodOfDate(businessToday())) throw new AccountingError(`${period} hasn't started yet`);
  await lockRegister(tx);
  const [done] = await tx.select({ id: depreciationRuns.id }).from(depreciationRuns).where(eq(depreciationRuns.period, period));
  if (done) throw new AccountingError(`Depreciation for ${period} was already run`);
  const last = await latestRun(tx);
  if (last && period < last) throw new AccountingError(`Depreciation is already run through ${last}`);
  const end = monthEnd(periodStart(period));
  const assets = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.status, "ACTIVE"), lte(fixedAssets.depreciateFrom, period))).orderBy(asc(fixedAssets.tag)).for("update");
  // Months run in order: an asset depreciated from before this month needed last month's run.
  if (assets.some((a) => a.depreciateFrom < period)) {
    const [prev] = await tx.select({ id: depreciationRuns.id }).from(depreciationRuns).where(eq(depreciationRuns.period, prevPeriod(period)));
    if (!prev) throw new AccountingError(`Run the depreciation for ${prevPeriod(period)} first`);
  }
  const rows = assets.map((a) => ({ asset: a, amount: monthlyDepreciation(a, period) })).filter((r) => r.amount > 0n);
  const total = rows.reduce((s, r) => s + r.amount, 0n);
  let jeId: string | null = null;
  if (total > 0n) {
    const byClass = new Map<string, Money>();
    for (const r of rows) byClass.set(r.asset.classCode, (byClass.get(r.asset.classCode) ?? 0n) + r.amount);
    const lines: LineInput[] = [{ accountId: await accountIdFor("depreciation_expense", tx), debit: total, memo: `Depreciation ${period}` }];
    for (const [cls, amount] of [...byClass].sort(([a], [b]) => a.localeCompare(b))) lines.push({ accountId: await accountIdFor(`accumulated_depreciation_${cls}`, tx), credit: amount, memo: `Depreciation ${period}` });
    const je = await postJournal(tx, { date: end, book: "GJ", particulars: `Depreciation for ${period} (${rows.length} asset${rows.length === 1 ? "" : "s"})`, reference: `DEP-${period}`, source: { module: "accounting.depreciation", id: null }, lines }, actorId);
    jeId = je.id;
  }
  const [run] = await tx.insert(depreciationRuns).values({ period, total, jeId, ranBy: actorId, createdBy: actorId }).returning();
  if (!run) throw new Error("depreciation run insert returned no row");
  for (const r of rows) {
    const accumulated = r.asset.accumulated + r.amount;
    await tx.insert(assetDepreciation).values({ runId: run.id, assetId: r.asset.id, period, amount: r.amount, accumulatedAfter: accumulated, createdBy: actorId });
    await tx
      .update(fixedAssets)
      .set({ accumulated, status: accumulated === r.asset.cost - r.asset.salvage ? "FULLY_DEPRECIATED" : "ACTIVE" })
      .where(eq(fixedAssets.id, r.asset.id));
  }
  await audit(tx, { action: "fa.depreciation_run", entity: "depreciation_run", entityId: run.id, after: { period, total: format(total), assets: rows.length }, userId: actorId });
  return { id: run.id, total, jeId, assets: rows.length };
}

/** What an asset was depreciated in a month (0 if nothing). */
export async function depreciationOf(assetId: string, period: string, db: Db | Tx = getDb()): Promise<Money> {
  const [r] = await db.select({ amount: assetDepreciation.amount }).from(assetDepreciation).where(and(eq(assetDepreciation.assetId, assetId), eq(assetDepreciation.period, period)));
  return r?.amount ?? 0n;
}

/** The register: each asset with its book value. */
export async function listAssets(db: Db | Tx = getDb()) {
  const rows = await db.select({ asset: fixedAssets, className: assetClasses.name }).from(fixedAssets).innerJoin(assetClasses, eq(assetClasses.code, fixedAssets.classCode)).orderBy(asc(fixedAssets.tag));
  return rows.map((r) => ({ ...r, bookValue: r.asset.cost - r.asset.accumulated }));
}

export async function listAssetClasses(db: Db | Tx = getDb()) {
  return db.select().from(assetClasses).orderBy(asc(assetClasses.name));
}

export async function listDepreciationRuns(db: Db | Tx = getDb()) {
  return db.select().from(depreciationRuns).orderBy(sql`${depreciationRuns.period} DESC`).limit(60);
}

/** Whether the month's depreciation is posted (or nothing needed it): for the month-close checklist. */
export async function depreciationDone(period: string, db: Db | Tx = getDb()): Promise<{ ok: boolean; detail: string }> {
  const [run] = await db.select().from(depreciationRuns).where(eq(depreciationRuns.period, period));
  if (run) return { ok: true, detail: `Posted: ${format(run.total)}` };
  const due = (await db.select().from(fixedAssets).where(and(eq(fixedAssets.status, "ACTIVE"), lte(fixedAssets.depreciateFrom, period)))).filter((a) => monthlyDepreciation(a, period) > 0n);
  return due.length ? { ok: false, detail: `Not run: ${due.length} asset${due.length === 1 ? "" : "s"} to depreciate` } : { ok: true, detail: "No assets to depreciate" };
}
