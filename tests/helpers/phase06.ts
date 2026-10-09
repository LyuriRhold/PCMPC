import { withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import {
  addMeterAction,
  addSeniorEligibilityAction,
  approveApplicationAction,
  createApplicationAction,
  installMeterAction,
} from "@/modules/water/actions";
import { approveReadingAction, enterReadingAction, openPeriodAction } from "@/modules/water/billing-actions";
import { waterRoutes, waterZones } from "@/modules/water/schema";
import { makeUser } from "./phase01";
import { applicant, approveAs, createApplicantAs } from "./phase02";
import { openSessionAs } from "./phase04";
import { createCustomerAs, nonMember, payFees, setupWater } from "./phase05";

/** 2026-10-07 09:00 Manila: bill date of the 2026-10 test period. */
export const OCT_7 = new Date("2026-10-07T01:00:00Z");

let tellerId = "";
let sessionOpen = false;
let serial = 0;
let names = 0;

/** Water setup (Phase 05) plus a meter reader and zone Z1 with route Z1-R1. */
export async function setupBilling() {
  const base = await setupWater();
  setClock(() => OCT_7);
  const reader = await makeUser("METER_READER", "reader1");
  const { zoneId, routeId } = await withTx(async (tx) => {
    const [zone] = await tx.insert(waterZones).values({ code: "Z1", name: "Zone 1" }).returning();
    const [route] = await tx.insert(waterRoutes).values({ zoneId: zone!.id, code: "Z1-R1", name: "Zone 1 route 1" }).returning();
    return { zoneId: zone!.id, routeId: route!.id };
  });
  tellerId = base.teller.id;
  sessionOpen = false;
  serial = 0;
  names = 0;
  return { ...base, reader, zoneId, routeId };
}

type AccountOpts = {
  clerk: string;
  manager: string;
  routeId: string;
  kind?: "MEMBER" | "NON_MEMBER";
  classification?: "RESIDENTIAL" | "COMMERCIAL";
  initialReading?: number;
  digits?: number;
  senior?: boolean;
};

/** An ACTIVE account on `routeId`: customer → application → approval → fees → meter installed. */
export async function activeAccount(o: AccountOpts) {
  names += 1;
  let customer: { id: string; customerNo: string };
  if (o.kind === "MEMBER") {
    const memberId = await createApplicantAs(o.manager, applicant({ firstName: `Juan ${names}`, birthdate: `1950-01-${String(names).padStart(2, "0")}` }));
    await approveAs(o.manager, memberId);
    customer = await createCustomerAs(o.clerk, nonMember({ type: "MEMBER", memberId }));
  } else {
    customer = await createCustomerAs(o.clerk, nonMember({ firstName: `Maria ${names}` }));
  }
  const app = await runAs(o.clerk, () =>
    createApplicationAction({ customerId: customer.id, classification: o.classification ?? "RESIDENTIAL", serviceAddress: `Purok ${names}, Pipindan`, routeId: o.routeId }),
  );
  if (!app.ok) throw new Error(app.error);
  const approved = await runAs(o.manager, () => approveApplicationAction({ applicationId: app.data.id }));
  if (!approved.ok) throw new Error(approved.error);
  if (!sessionOpen) {
    await openSessionAs(tellerId, "0");
    sessionOpen = true;
  }
  await payFees(tellerId, customer.id, app.data.id, false);
  serial += 1;
  const serialNo = `SN-B${serial}`;
  const m = await runAs(o.clerk, () => addMeterAction({ serialNo, brand: null, size: null, digits: o.digits ?? 4 }));
  if (!m.ok) throw new Error(m.error);
  const inst = await runAs(o.clerk, () => installMeterAction({ applicationId: app.data.id, meterSerial: serialNo, initialReading: o.initialReading ?? 0 }));
  if (!inst.ok) throw new Error(inst.error);
  if (o.senior) {
    const s = await runAs(o.clerk, () =>
      addSeniorEligibilityAction({ accountId: approved.data.accountId, seniorName: "Lola Senior", oscaIdNo: `OSCA-${names}`, validFrom: "2026-01-01", validUntil: "2027-12-31" }),
    );
    if (!s.ok) throw new Error(s.error);
  }
  return { customer, accountId: approved.data.accountId, accountNo: approved.data.accountNo, serialNo };
}

/** Opens `period` (YYYY-MM) for the zone: reading window 1st–5th, bill date the 7th. */
export async function openPeriod(userId: string, zoneId: string, period: string) {
  const r = await runAs(userId, () =>
    openPeriodAction({ period, zoneId, readingFrom: `${period}-01`, readingTo: `${period}-05`, billDate: `${period}-07` }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

export async function read(userId: string, periodId: string, accountId: string, presentReading: number, rollover = false) {
  return runAs(userId, () => enterReadingAction({ periodId, accountId, presentReading, rollover, remarks: null }));
}

/** Enters a reading and approves it if it was flagged; throws on rejection. */
export async function readApproved(userId: string, periodId: string, accountId: string, presentReading: number) {
  const r = await read(userId, periodId, accountId, presentReading);
  if (!r.ok) throw new Error(r.error);
  if (r.data.status !== "APPROVED") {
    const a = await runAs(userId, () => approveReadingAction({ readingId: r.data.id }));
    if (!a.ok) throw new Error(a.error);
  }
  return r.data;
}
