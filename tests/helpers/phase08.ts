import { runAs } from "@/lib/auth-guard";
import { businessToday, setClock } from "@/lib/dates";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import { subscribeAction } from "@/modules/share/actions";
import { makeUser } from "./phase01";
import { approveMemberAction } from "@/modules/members/actions";
import { applicant, createApplicantAs } from "./phase02";
import { openSessionAs, setupCashiering } from "./phase04";

/** Manila 09:00 on a business date. */
export function at(date: string): Date {
  return new Date(`${date}T01:00:00Z`);
}

let manager = "";
let tellerDay = "";
let tellerId = "";
let seq = 0;

/** Reference data, FY 2026, a manager (encodes subscriptions, transfers) and a teller per day. */
export async function setupShares() {
  const base = await setupCashiering();
  manager = base.manager.id;
  tellerDay = "";
  tellerId = "";
  seq = 0;
  return base;
}

/** An approved (ACTIVE) member with a distinct name; returns its id. */
export async function member(lastName = "Member"): Promise<string> {
  seq += 1;
  const id = await createApplicantAs(manager, applicant({ lastName, firstName: `Juan ${seq}`, birthdate: `1980-01-${String((seq % 28) + 1).padStart(2, "0")}`, tin: null, validIdNo: `ID-${seq}` }));
  // PMES on the (test) business date: a fixed PMES date would be in the future for early-2026 fixtures.
  const r = await runAs(manager, () => approveMemberAction({ memberId: id, pmesDate: businessToday(), bodResolutionNo: "2026-15", privacyConsent: true }));
  if (!r.ok) throw new Error(r.error);
  return id;
}

export async function subscribe(memberId: string, shares: number) {
  const r = await runAs(manager, () => subscribeAction({ memberId, shares }));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** A teller with an open session today (a new teller per business day). */
export async function tellerToday(): Promise<string> {
  if (tellerDay !== businessToday()) {
    tellerId = (await makeUser("TELLER", `shr_${businessToday().replaceAll("-", "")}`)).id;
    await openSessionAs(tellerId, "0");
    tellerDay = businessToday();
  }
  return tellerId;
}

export async function receipt(memberId: string, items: Array<{ type: string; amount: string }>) {
  const teller = await tellerToday();
  return runAs(teller, () =>
    issueReceiptAction({
      payor: { type: "MEMBER", id: memberId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: `BIR-${Math.random().toString(36).slice(2, 10)}`,
      items: items.map((i) => ({ type: i.type, refId: memberId, amount: i.amount, description: null })),
    }),
  );
}

/** Pays `amount` (pesos text) on the member's share subscription at the teller. */
export function pay(memberId: string, amount: string) {
  return receipt(memberId, [{ type: "SHARE_PAYMENT", amount }]);
}

/**
 * `n` other members, each subscribing 100 shares and paying ₱2,500.00 (the minimum paid-up,
 * which the holding cap always allows): builds up the coop's total paid-up for the cap tests.
 */
export async function fillers(n: number, date: string): Promise<void> {
  setClock(() => at(date));
  for (let i = 0; i < n; i++) {
    const id = await member("Filler");
    await subscribe(id, 100);
    const r = await pay(id, "2,500.00");
    if (!r.ok) throw new Error(r.error);
  }
}
