import { withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { submitApplicationAction } from "@/modules/loans/actions";
import { loanProductByCode } from "@/modules/loans/service";
import { updateSetting } from "@/modules/settings/service";
import { makeUser } from "./phase01";
import { member, receipt, setupShares, subscribe } from "./phase08";

let manager = "";
let officer = "";
let committee = "";

/** Reference data, FY 2026, the manager, a loan officer (lo1) and a Credit Committee member (cc1). */
export async function setupLoans() {
  const base = await setupShares();
  manager = base.manager.id;
  officer = (await makeUser("LOAN_OFFICER", "lo1")).id;
  committee = (await makeUser("CREDIT_COMMITTEE", "cc1")).id;
  return { ...base, officer, committee };
}

export const managerId = () => manager;
export const officerId = () => officer;
export const committeeId = () => committee;

/** An ACTIVE member in good standing: 100 shares subscribed, `paidUp` paid and the membership fee paid. */
export async function goodStandingMember(lastName = "Borrower", paidUp = "2,500.00"): Promise<string> {
  const id = await member(lastName);
  await subscribe(id, 100);
  const r = await receipt(id, [
    { type: "SHARE_PAYMENT", amount: paidUp },
    { type: "MEMBERSHIP_FEE", amount: "500.00" },
  ]);
  if (!r.ok) throw new Error(r.error);
  return id;
}

/** Sets the minimum paid-up for good standing (payments up to it are exempt from the 10% holding cap). */
export async function setMinPaidUp(centavos: string): Promise<void> {
  await withTx((tx) => updateSetting(tx, "share.min_paid_up_regular", centavos, manager));
}

export async function productId(code: "REG" | "EMR" | "PRD"): Promise<string> {
  const p = await loanProductByCode(code);
  if (!p) throw new Error(`loan product ${code} not seeded`);
  return p.id;
}

/** The loan officer submits an application; returns the action result. */
export async function apply(input: { memberId: string; product: "REG" | "EMR" | "PRD"; amount: string; term: number; comakerIds?: string[]; purpose?: string }) {
  const pid = await productId(input.product);
  return runAs(officer, () =>
    submitApplicationAction({ memberId: input.memberId, productId: pid, amount: input.amount, term: input.term, purpose: input.purpose ?? "Business capital", comakerIds: input.comakerIds ?? [] }),
  );
}
