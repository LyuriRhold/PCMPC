"use server";

import "@/modules/plugins";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { parse as parseMoney } from "@/lib/money";
import { members } from "@/modules/members/schema";
import { addRateSchedule, RateError } from "./rates";
import { CLASSIFICATIONS, TARIFF_APPLIES_TO, waterCustomers } from "./schema";
import {
  activateAccount,
  addMeter,
  addSeniorEligibility,
  approveApplication,
  createApplication,
  createCustomer,
  customerName,
  inspectApplication,
  installMeter,
  moveAccountToRoute,
  rejectApplication,
  reorderRoute,
  replaceMeter,
  setMeterStatus,
  transferAccount,
  WaterError,
} from "./service";

const EXPECTED = [WaterError, RateError];
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const businessDate = z.string().refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)");
const classification = z.enum(CLASSIFICATIONS);
const reading = z.number().int().min(0).max(999_999_999);

function pesos(textValue: string, what: string): bigint {
  try {
    return parseMoney(textValue);
  } catch {
    throw new WaterError(`Enter a valid ${what} (e.g. 25.00)`);
  }
}

// ── Customers ──

const customerSchema = z.object({
  type: z.enum(["MEMBER", "NON_MEMBER"]),
  memberId: z.uuid().nullable(),
  lastName: optText(80),
  firstName: optText(80),
  middleName: optText(80),
  businessName: optText(160),
  address: text(300),
  mobile: optText(20).refine((v) => v === null || /^[0-9+\-\s()]{7,20}$/.test(v), "Enter a valid mobile number"),
  email: optText(200).refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid e-mail"),
  validIdType: optText(60),
  validIdNo: optText(40),
  privacyConsent: z.boolean(),
  remarks: optText(500),
});

export async function createCustomerAction(input: z.input<typeof customerSchema>): Promise<ActionResult<{ id: string; customerNo: string }>> {
  const actor = await requirePermission("water.customers");
  try {
    const data = customerSchema.parse(input);
    const c = await withTx((tx) => createCustomer(tx, data, actor.id));
    return ok({ id: c.id, customerNo: c.customerNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const memberNoSchema = z.object({ memberNo: text(20).min(1, "Enter the member no.") });
/** Finds an approved member by member no. for linking a MEMBER customer. */
export async function findMemberAction(input: z.input<typeof memberNoSchema>): Promise<ActionResult<{ id: string; name: string; status: string; address: string }>> {
  await requirePermission("water.customers");
  try {
    const { memberNo } = memberNoSchema.parse(input);
    const [m] = await getDb().select().from(members).where(eq(members.memberNo, memberNo.toUpperCase()));
    if (!m) throw new WaterError(`No member ${memberNo.toUpperCase()}`);
    return ok({
      id: m.id,
      name: `${m.lastName}, ${m.firstName}${m.middleName ? ` ${m.middleName}` : ""}`,
      status: m.status,
      address: [m.addrStreet, m.addrPurok, m.addrBarangay, m.addrMunicipality, m.addrProvince].filter(Boolean).join(", "),
    });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const customerNoSchema = z.object({ customerNo: text(20).min(1, "Enter the customer no.") });
/** Finds a water customer by customer no. (e.g. the new owner in a transfer). */
export async function findCustomerAction(input: z.input<typeof customerNoSchema>): Promise<ActionResult<{ id: string; name: string }>> {
  await requirePermission("water.customers");
  try {
    const { customerNo } = customerNoSchema.parse(input);
    const [c] = await getDb().select().from(waterCustomers).where(eq(waterCustomers.customerNo, customerNo.toUpperCase()));
    if (!c) throw new WaterError(`No customer ${customerNo.toUpperCase()}`);
    return ok({ id: c.id, name: customerName(c) });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Applications ──

const applicationSchema = z.object({ customerId: z.uuid(), classification, serviceAddress: text(300).min(1, "Service address is required"), routeId: z.uuid().nullable() });
export async function createApplicationAction(input: z.input<typeof applicationSchema>): Promise<ActionResult<{ id: string; appNo: string }>> {
  const actor = await requirePermission("water.apply");
  try {
    const data = applicationSchema.parse(input);
    const a = await withTx((tx) => createApplication(tx, data, actor.id));
    return ok({ id: a.id, appNo: a.appNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const inspectSchema = z.object({ applicationId: z.uuid(), notes: text(1000) });
export async function inspectApplicationAction(input: z.input<typeof inspectSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.install");
  try {
    const data = inspectSchema.parse(input);
    await withTx((tx) => inspectApplication(tx, data.applicationId, data.notes, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const appIdSchema = z.object({ applicationId: z.uuid() });
/** Approves; throws (not returns) when the approver encoded the application (SoD). */
export async function approveApplicationAction(input: z.input<typeof appIdSchema>): Promise<ActionResult<{ accountId: string; accountNo: string }>> {
  const actor = await requirePermission("water.approve");
  try {
    const { applicationId } = appIdSchema.parse(input);
    const { account } = await withTx((tx) => approveApplication(tx, applicationId, actor.id));
    return ok({ accountId: account.id, accountNo: account.accountNo });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const rejectSchema = z.object({ applicationId: z.uuid(), reason: text(300).min(1, "A reason is required") });
export async function rejectApplicationAction(input: z.input<typeof rejectSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.approve");
  try {
    const data = rejectSchema.parse(input);
    await withTx((tx) => rejectApplication(tx, data.applicationId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Meters and accounts ──

const meterSchema = z.object({ serialNo: text(40).min(1, "Serial no. is required"), brand: optText(60), size: optText(20), digits: z.number().int().min(3).max(9) });
export async function addMeterAction(input: z.input<typeof meterSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("water.install");
  try {
    const data = meterSchema.parse(input);
    const m = await withTx((tx) => addMeter(tx, data, actor.id));
    return ok({ id: m.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const meterStatusSchema = z.object({ meterId: z.uuid(), status: z.enum(["IN_STOCK", "DEFECTIVE", "RETIRED"]) });
export async function setMeterStatusAction(input: z.input<typeof meterStatusSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.install");
  try {
    const data = meterStatusSchema.parse(input);
    await withTx((tx) => setMeterStatus(tx, data.meterId, data.status, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const installSchema = z.object({ applicationId: z.uuid(), meterSerial: text(40).min(1, "Enter the meter serial no."), initialReading: reading });
export async function installMeterAction(input: z.input<typeof installSchema>): Promise<ActionResult<{ accountNo: string }>> {
  const actor = await requirePermission("water.install");
  try {
    const data = installSchema.parse(input);
    return ok(await withTx((tx) => installMeter(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const accountIdSchema = z.object({ accountId: z.uuid() });
export async function activateAccountAction(input: z.input<typeof accountIdSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.install");
  try {
    const { accountId } = accountIdSchema.parse(input);
    await withTx((tx) => activateAccount(tx, accountId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const replaceSchema = z.object({
  accountId: z.uuid(),
  oldFinalReading: reading,
  oldMeterStatus: z.enum(["IN_STOCK", "DEFECTIVE", "RETIRED"]),
  newMeterSerial: text(40).min(1, "Enter the new meter's serial no."),
  newInitialReading: reading,
  reason: text(300).min(1, "A reason is required"),
});
export async function replaceMeterAction(input: z.input<typeof replaceSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.install");
  try {
    const data = replaceSchema.parse(input);
    await withTx((tx) => replaceMeter(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const transferSchema = z.object({ accountId: z.uuid(), newCustomerId: z.uuid(), reason: text(300).min(1, "A reason is required") });
export async function transferAccountAction(input: z.input<typeof transferSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.customers");
  try {
    const data = transferSchema.parse(input);
    await withTx((tx) => transferAccount(tx, data.accountId, data.newCustomerId, data.reason, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Routes ──

const reorderSchema = z.object({ routeId: z.uuid(), accountIds: z.array(z.uuid()).max(5000) });
export async function reorderRouteAction(input: z.input<typeof reorderSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.customers");
  try {
    const data = reorderSchema.parse(input);
    await withTx((tx) => reorderRoute(tx, data.routeId, data.accountIds, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const moveSchema = z.object({ accountId: z.uuid(), routeId: z.uuid() });
export async function moveAccountToRouteAction(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.customers");
  try {
    const data = moveSchema.parse(input);
    await withTx((tx) => moveAccountToRoute(tx, data.accountId, data.routeId, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

// ── Rates and senior eligibility ──

const scheduleSchema = z.object({
  classification,
  appliesTo: z.enum(TARIFF_APPLIES_TO).default("ALL"),
  effectiveFrom: businessDate,
  minCharge: text(20),
  minCubic: z.number().int().min(0).max(1000),
  blocks: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0).nullable(), rate: text(20) })).min(1).max(20),
  nwrbRef: text(200).min(1, "Enter the NWRB approval reference"),
});
export async function addRateScheduleAction(input: z.input<typeof scheduleSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("water.rates");
  try {
    const data = scheduleSchema.parse(input);
    const row = await withTx((tx) =>
      addRateSchedule(
        tx,
        {
          classification: data.classification,
          appliesTo: data.appliesTo,
          effectiveFrom: data.effectiveFrom,
          minCharge: pesos(data.minCharge, "minimum charge"),
          minCubic: data.minCubic,
          blocks: data.blocks.map((b) => ({ from: b.from, to: b.to, rate: String(pesos(b.rate, "rate per m³")) })),
          nwrbRef: data.nwrbRef,
        },
        actor.id,
      ),
    );
    return ok({ id: row.id });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const seniorSchema = z.object({ accountId: z.uuid(), seniorName: text(160), oscaIdNo: text(40), validFrom: businessDate, validUntil: businessDate });
export async function addSeniorEligibilityAction(input: z.input<typeof seniorSchema>): Promise<ActionResult> {
  const actor = await requirePermission("water.customers");
  try {
    const data = seniorSchema.parse(input);
    await withTx((tx) => addSeniorEligibility(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
