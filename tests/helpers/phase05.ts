import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import {
  addMeterAction,
  approveApplicationAction,
  createApplicationAction,
  createCustomerAction,
  installMeterAction,
} from "@/modules/water/actions";
import { waterRoutes } from "@/modules/water/schema";
import { makeUser } from "./phase01";
import { DAY, openSessionAs, setupCashiering } from "./phase04";
import { setClock } from "@/lib/dates";

export { DAY };

/** Reference data, ledger FY 2026, the clock at 2026-10-07, and the water users. */
export async function setupWater() {
  const base = await setupCashiering();
  setClock(() => DAY);
  const clerk = await makeUser("BILLING_CLERK", "clerk1");
  return { ...base, clerk };
}

/** The seeded default route (CONFIRM: one route until PCMPC sends its zones/routes). */
export async function defaultRouteId(): Promise<string> {
  const [r] = await getDb().select().from(waterRoutes).limit(1);
  if (!r) throw new Error("no water route seeded");
  return r.id;
}

export function nonMember(overrides: Record<string, unknown> = {}) {
  return {
    type: "NON_MEMBER" as const,
    memberId: null,
    lastName: "Santos",
    firstName: "Maria",
    middleName: null,
    businessName: null,
    address: "Purok 2, Pipindan, Binangonan, Rizal",
    mobile: "09181234567",
    email: null,
    validIdType: "PhilSys ID",
    validIdNo: "1111-2222-3333-4444",
    privacyConsent: true,
    remarks: null,
    ...overrides,
  };
}

export async function createCustomerAs(userId: string, input = nonMember()) {
  const r = await runAs(userId, () => createCustomerAction(input));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

let customerSeq = 0;

/** Customer → application → approval; returns ids. Each call creates a differently named customer. */
export async function approvedApplication(clerkId: string, managerId: string, classification: "RESIDENTIAL" | "COMMERCIAL" = "RESIDENTIAL") {
  customerSeq += 1;
  const customer = await createCustomerAs(clerkId, nonMember(customerSeq === 1 ? {} : { firstName: `Maria ${customerSeq}` }));
  const app = await runAs(clerkId, () =>
    createApplicationAction({ customerId: customer.id, classification, serviceAddress: "Purok 2, Pipindan", routeId: null }),
  );
  if (!app.ok) throw new Error(app.error);
  const approved = await runAs(managerId, () => approveApplicationAction({ applicationId: app.data.id }));
  if (!approved.ok) throw new Error(approved.error);
  return { customer, applicationId: app.data.id, accountId: approved.data.accountId, accountNo: approved.data.accountNo };
}

/** Teller collects the connection fee and meter deposit for an application (opens a session if needed). */
export async function payFees(tellerId: string, customerId: string, applicationId: string, openSession = true) {
  if (openSession) await openSessionAs(tellerId, "0");
  const r = await runAs(tellerId, () =>
    issueReceiptAction({
      payor: { type: "WATER_CUSTOMER", id: customerId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: "BIR-W-1",
      items: [
        { type: "WATER_CONNECTION_FEE", refId: applicationId, amount: "3,500.00", description: null },
        { type: "METER_DEPOSIT", refId: applicationId, amount: "1,000.00", description: null },
      ],
    }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export async function addMeter(userId: string, serialNo: string) {
  const r = await runAs(userId, () => addMeterAction({ serialNo, brand: "Generic", size: "1/2 in", digits: 4 }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

export async function install(userId: string, applicationId: string, serialNo: string, initialReading = 0) {
  return runAs(userId, () => installMeterAction({ applicationId, meterSerial: serialNo, initialReading }));
}

