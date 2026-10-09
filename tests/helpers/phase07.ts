import { runAs } from "@/lib/auth-guard";
import { businessToday, monthEnd, setClock } from "@/lib/dates";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import { openPeriodAction, postBillingAction } from "@/modules/water/billing-actions";
import { makeUser } from "./phase01";
import { openSessionAs } from "./phase04";
import { readApproved, setupBilling } from "./phase06";

/** Manila 09:00 on a business date. */
export function at(date: string): Date {
  return new Date(`${date}T01:00:00Z`);
}

let tellerDay = "";
let tellerId = "";

export async function setupCollections() {
  const base = await setupBilling();
  tellerDay = "";
  tellerId = "";
  return base;
}

/**
 * Opens `period` with the Phase 07 fixture dates: reading 1st–25th, bill date the month's last day,
 * so bills are due on the 15th of the next month (water.due_days = 15). Sets the clock to the bill date.
 */
export async function openPeriod15(userId: string, zoneId: number, period: string) {
  const billDate = monthEnd(`${period}-01`);
  setClock(() => at(billDate));
  const r = await runAs(userId, () => openPeriodAction({ period, zoneId, readingFrom: `${period}-01`, readingTo: `${period}-25`, billDate }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** Opens the period, reads each account (present readings), and posts the run on the bill date. */
export async function billMonth(clerk: string, zoneId: number, period: string, readings: Array<[accountId: string, present: number]>) {
  const periodId = await openPeriod15(clerk, zoneId, period);
  for (const [accountId, present] of readings) await readApproved(clerk, periodId, accountId, present);
  const run = await runAs(clerk, () => postBillingAction({ periodId }));
  if (!run.ok) throw new Error(run.error);
  return { periodId, jeId: run.data.jeId };
}

/** A teller with an open session today (a new teller per business day). */
export async function tellerToday(): Promise<string> {
  if (tellerDay !== businessToday()) {
    tellerId = (await makeUser("TELLER", `pay_${businessToday().replaceAll("-", "")}`)).id;
    await openSessionAs(tellerId, "0");
    tellerDay = businessToday();
  }
  return tellerId;
}

/** Pays `amount` (pesos text) on a water account at the teller, on the current clock date. */
export async function payWater(customerId: string, accountId: string, amount: string) {
  const teller = await tellerToday();
  return runAs(teller, () =>
    issueReceiptAction({
      payor: { type: "WATER_CUSTOMER", id: customerId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: `BIR-${Math.random().toString(36).slice(2, 10)}`,
      items: [{ type: "WATER_BILL", refId: accountId, amount, description: null }],
    }),
  );
}

/** Pays the reconnection fee (WATER_OTHER_FEE "RECONNECTION"). */
export async function payReconnectionFee(customerId: string) {
  const teller = await tellerToday();
  return runAs(teller, () =>
    issueReceiptAction({
      payor: { type: "WATER_CUSTOMER", id: customerId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: `BIR-${Math.random().toString(36).slice(2, 10)}`,
      items: [{ type: "WATER_OTHER_FEE", refId: "RECONNECTION", amount: "300.00", description: null }],
    }),
  );
}
