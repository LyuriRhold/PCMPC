import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { businessToday, now, setClock } from "@/lib/dates";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import { approveMemberAction } from "@/modules/members/actions";
import { decideApplicationAction, submitApplicationAction } from "@/modules/loans/actions";
import { authorizeReleaseAction, payOutProceedsAction } from "@/modules/loans/servicing-actions";
import { loanProducts } from "@/modules/loans/schema";
import { loanProductByCode } from "@/modules/loans/service";
import { subscribeAction } from "@/modules/share/actions";
import { makeUser } from "./phase01";
import { applicant, createApplicantAs } from "./phase02";
import { openSessionAs, setupCashiering } from "./phase04";
import { setupCollections } from "./phase07";

/** Manila 09:00 on a business date. */
export function at(date: string): Date {
  return new Date(`${date}T01:00:00Z`);
}

/** Sets the business date (Manila). */
export function on(date: string): void {
  setClock(() => at(date));
}

const users = { manager: "", manager2: "", officer: "", committee: "" };
let tellerDay = "";
let tellerId = "";
let seq = 0;

/**
 * Reference data, FY 2026 and the loan people: the manager (approves), a second manager (authorizes
 * releases: never the approver), a loan officer and a Credit Committee member. With `water`, the
 * water collections setup (zone, route, clerk) too. Keeps the business date the caller set.
 */
type CashBase = Awaited<ReturnType<typeof setupCashiering>>;
type WaterBase = Awaited<ReturnType<typeof setupCollections>>;

export async function setupServicing(opts: { water: true }): Promise<WaterBase>;
export async function setupServicing(opts?: { water?: false }): Promise<CashBase>;
export async function setupServicing(opts: { water?: boolean } = {}): Promise<CashBase | WaterBase> {
  const callerNow = now();
  const base = opts.water ? await setupCollections() : await setupCashiering();
  setClock(() => callerNow);
  users.manager = base.manager.id;
  users.manager2 = (await makeUser("MANAGER", "manager2")).id;
  users.officer = (await makeUser("LOAN_OFFICER", "lo1")).id;
  users.committee = (await makeUser("CREDIT_COMMITTEE", "cc1")).id;
  tellerDay = "";
  tellerId = "";
  seq = 0;
  // The golden A10.1 loan is ₱10,000.00 on ₱2,500.00 paid-up: lend up to 4× paid-up on REG (product configuration).
  await getDb().update(loanProducts).set({ maxMultipleOfPaidUp: "4" }).where(eq(loanProducts.code, "REG"));
  // A member paying more than the ₱2,500.00 minimum must stay within 10% of the coop's paid-up
  // (holding cap): 14 other members with ₱2,500.00 each make room for A11.14's ₱3,700.00.
  if (opts.water) for (let i = 0; i < 14; i++) await fillerShareholder();
  return base;
}

export const people = () => users;

/** Another member with 100 shares and ₱2,500.00 paid-up (always within the holding cap). */
async function fillerShareholder(): Promise<void> {
  const id = await member("Filler");
  const s = await runAs(users.manager, () => subscribeAction({ memberId: id, shares: 100 }));
  if (!s.ok) throw new Error(s.error);
  const r = await receipt(id, [{ type: "SHARE_PAYMENT", amount: "2,500.00" }]);
  if (!r.ok) throw new Error(r.error);
}

/** A teller with an open session today holding ₱100,000.00 (so loan proceeds can be paid out). */
export async function tellerToday(): Promise<string> {
  if (tellerDay !== businessToday()) {
    tellerId = (await makeUser("TELLER", `ln_${businessToday().replaceAll("-", "")}`)).id;
    await openSessionAs(tellerId, "100,000.00");
    tellerDay = businessToday();
  }
  return tellerId;
}

/** An ACTIVE member (applicant approved today); returns its id. */
export async function member(lastName = "Member"): Promise<string> {
  seq += 1;
  const id = await createApplicantAs(users.manager, applicant({ lastName, firstName: `Rosa ${seq}`, birthdate: `1975-03-${String((seq % 28) + 1).padStart(2, "0")}`, tin: null, validIdNo: `ID-L${seq}` }));
  const r = await runAs(users.manager, () => approveMemberAction({ memberId: id, pmesDate: businessToday(), bodResolutionNo: "2026-15", privacyConsent: true }));
  if (!r.ok) throw new Error(r.error);
  return id;
}

/** A teller receipt for a member (each item's refId defaults to the member). */
export async function receipt(memberId: string, items: Array<{ type: string; amount: string; refId?: string }>) {
  const teller = await tellerToday();
  return runAs(teller, () =>
    issueReceiptAction({
      payor: { type: "MEMBER", id: memberId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: `BIR-${Math.random().toString(36).slice(2, 10)}`,
      items: items.map((i) => ({ type: i.type, refId: i.refId ?? memberId, amount: i.amount, description: null })),
    }),
  );
}

/** Good standing: 100 shares, ₱2,500.00 paid-up and the membership fee (two receipts; their ids are returned). */
export async function goodStanding(memberId: string) {
  const s = await runAs(users.manager, () => subscribeAction({ memberId, shares: 100 }));
  if (!s.ok) throw new Error(s.error);
  const shares = await receipt(memberId, [{ type: "SHARE_PAYMENT", amount: "2,500.00" }]);
  if (!shares.ok) throw new Error(shares.error);
  const fee = await receipt(memberId, [{ type: "MEMBERSHIP_FEE", amount: "500.00" }]);
  if (!fee.ok) throw new Error(fee.error);
  return { shareReceiptId: shares.data.id, feeReceiptId: fee.data.id };
}

/**
 * A released loan (today): good-standing borrower, a comaker, the loan officer applies, the manager
 * approves, the second manager authorizes the release with `firstDueDate`, and today's teller pays
 * the proceeds out in cash.
 */
export async function releasedLoan(opts: { memberId?: string; product?: "REG" | "EMR" | "PRD"; amount?: string; term?: number; firstDueDate: string; lastName?: string }) {
  const borrower = opts.memberId ?? (await member(opts.lastName ?? "Borrower"));
  if (!opts.memberId) await goodStanding(borrower);
  const product = await loanProductByCode(opts.product ?? "REG");
  if (!product) throw new Error("product not seeded");
  const comakers = product.requiredComakers > 0 ? [await member("Comaker")] : [];
  const app = await runAs(users.officer, () =>
    submitApplicationAction({ memberId: borrower, productId: product.id, amount: opts.amount ?? "10,000.00", term: opts.term ?? 12, purpose: "Working capital", comakerIds: comakers }),
  );
  if (!app.ok) throw new Error(app.error);
  const decided = await runAs(users.manager, () => decideApplicationAction({ applicationId: app.data.id, decision: "APPROVE", remarks: "OK" }));
  if (!decided.ok) throw new Error(decided.error);
  if (decided.data.status === "RECOMMENDED") {
    const cc = await runAs(users.committee, () => decideApplicationAction({ applicationId: app.data.id, decision: "APPROVE", remarks: "OK" }));
    if (!cc.ok) throw new Error(cc.error);
  }
  const auth = await runAs(users.manager2, () => authorizeReleaseAction({ applicationId: app.data.id, firstDueDate: opts.firstDueDate, disbursement: "CASH", savingsAccountId: null }));
  if (!auth.ok) throw new Error(auth.error);
  const paid = await runAs(await tellerToday(), () => payOutProceedsAction({ loanId: auth.data.loanId }));
  if (!paid.ok) throw new Error(paid.error);
  return { memberId: borrower, loanId: auth.data.loanId, loanNo: auth.data.loanNo, applicationId: app.data.id, releaseJeId: paid.data.jeId, comakers };
}

/** A loan payment at today's teller. */
export function payLoan(memberId: string, loanId: string, amount: string) {
  return receipt(memberId, [{ type: "LOAN_PAYMENT", amount, refId: loanId }]);
}
