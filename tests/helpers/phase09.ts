import { withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { businessToday, setClock } from "@/lib/dates";
import { issueReceiptAction } from "@/modules/cashiering/actions";
import { ensureFiscalYear } from "@/modules/ledger/periods";
import { approveMemberAction } from "@/modules/members/actions";
import { openAccountAction, withdrawAction } from "@/modules/savings/actions";
import { productByCode } from "@/modules/savings/service";
import { makeUser } from "./phase01";
import { applicant, createApplicantAs } from "./phase02";
import { openSessionAs, setupCashiering } from "./phase04";

/** Manila 09:00 on a business date. */
export function at(date: string): Date {
  return new Date(`${date}T01:00:00Z`);
}

/** Sets the business date (Manila). */
export function on(date: string): void {
  setClock(() => at(date));
}

let manager = "";
let bookkeeper = "";
let tellerDay = "";
let tellerId = "";
let seq = 0;

/** Reference data, FY 2026, a manager, a bookkeeper (interest runs) and a teller per business day. */
export async function setupSavings() {
  const base = await setupCashiering();
  manager = base.manager.id;
  bookkeeper = (await makeUser("BOOKKEEPER", "bookkeeper9")).id;
  tellerDay = "";
  tellerId = "";
  seq = 0;
  return { ...base, bookkeeper };
}

export async function fiscalYear(year: number): Promise<void> {
  await withTx((tx) => ensureFiscalYear(tx, year));
}

/** An applicant (not yet a member); returns its id. */
export async function applicantOnly(lastName = "Applicant"): Promise<string> {
  seq += 1;
  return createApplicantAs(manager, applicant({ lastName, firstName: `Ana ${seq}`, birthdate: `1985-02-${String((seq % 28) + 1).padStart(2, "0")}`, tin: null, validIdNo: `ID-S${seq}` }));
}

/** An approved (ACTIVE) member; returns its id. */
export async function activeMember(lastName = "Saver"): Promise<string> {
  const id = await applicantOnly(lastName);
  const r = await runAs(manager, () => approveMemberAction({ memberId: id, pmesDate: businessToday(), bodResolutionNo: "2026-15", privacyConsent: true }));
  if (!r.ok) throw new Error(r.error);
  return id;
}

/** A teller with an open session today (a new teller per business day). */
export async function tellerToday(): Promise<string> {
  if (tellerDay !== businessToday()) {
    tellerId = (await makeUser("TELLER", `sav_${businessToday().replaceAll("-", "")}`)).id;
    await openSessionAs(tellerId, "0");
    tellerDay = businessToday();
  }
  return tellerId;
}

export async function productId(code: "SAV" | "TD"): Promise<string> {
  const p = await productByCode(code);
  if (!p) throw new Error(`deposit product ${code} not seeded`);
  return p.id;
}

/** Opens the member's regular savings account at the teller; returns the account id. */
export async function openSavings(memberId: string): Promise<string> {
  const r = await runAs(await tellerToday(), async () => openAccountAction({ memberId, productId: await productId("SAV") }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** A cash deposit at the teller (receipt item SAVINGS_DEPOSIT). */
export async function deposit(memberId: string, accountId: string, amount: string) {
  const teller = await tellerToday();
  return runAs(teller, () =>
    issueReceiptAction({
      payor: { type: "MEMBER", id: memberId, name: "" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo: `BIR-${Math.random().toString(36).slice(2, 10)}`,
      items: [{ type: "SAVINGS_DEPOSIT", refId: accountId, amount, description: null }],
    }),
  );
}

/** A cash withdrawal paid out by today's teller (cash-out SAVINGS_WITHDRAWAL). */
export async function withdraw(accountId: string, amount: string) {
  return runAs(await tellerToday(), () => withdrawAction({ accountId, amount }));
}

export function bookkeeperId(): string {
  return bookkeeper;
}
