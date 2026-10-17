import { withTx, getPool } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { runDailyJobs } from "@/lib/cron";
import { addDays, type BusinessDate } from "@/lib/dates";
import { format, type Money } from "@/lib/money";
import { yearEndCloseAction } from "@/modules/accounting/actions";
import { operations } from "@/modules/accounting/statements";
import { accountIdFor, postJournal } from "@/modules/ledger/service";
import { productByCode } from "@/modules/savings/service";
import { openAccount } from "@/modules/savings/service";
import { subscribeAction } from "@/modules/share/actions";
import { updateSetting } from "@/modules/settings/service";
import { createProductAction, createSupplierAction, receiveAction } from "@/modules/store/actions";
import { completeSaleAction, openShiftAction } from "@/modules/store/pos-actions";
import { approveAllocationAction, draftAllocationAction, postAllocationAction } from "@/modules/surplus/actions";
import { makeUser } from "./phase01";
import { goodStanding, member, on, payLoan, people, receipt, releasedLoan, setupServicing } from "./phase11";

export { on };

const users = { manager: "", book: "", teller: "", clerk: "" };
export const surplusPeople = () => ({ ...users, manager2: people().manager2 });

/** Subscribes `shares` and pays `amount` at the teller (pesos). */
async function shares(memberId: string, subscribe: number, pay: string) {
  if (subscribe > 0) {
    const s = await runAs(users.manager, () => subscribeAction({ memberId, shares: subscribe }));
    if (!s.ok) throw new Error(s.error);
  }
  const r = await receipt(memberId, [{ type: "SHARE_PAYMENT", amount: pay }]);
  if (!r.ok) throw new Error(r.error);
}

/** Cash purchases at the store: `qty` of the ₱50.00 item. */
async function buy(productId: string, memberId: string, qty: number) {
  const r = await runAs(users.clerk, () => completeSaleAction({ memberId, payment: "CASH", lines: [{ productId, qty }], tendered: format(BigInt(qty) * 5000n).replace("₱", ""), birInvoiceNo: null }));
  if (!r.ok) throw new Error(r.error);
}

/**
 * The PHASE-15 golden fixture, fiscal year 2026, closed on Jan 5, 2027 with a net surplus of `netSurplus`:
 * - Jan 5: members A, B and C pay up ₱12,000.00, ₱9,000.00 and ₱77,000.00 of share capital, so their
 *   ASM for 2026 is the same (B is also in good standing: membership fee paid).
 * - Mar 10: store purchases (a ₱50.00 item): A ₱10,000.00, B ₱29,850.00, C ₱2,000.00.
 * - Nov 16: B borrows ₱10,000.00 (EMR, 4 months: ₱2,500.00 principal + ₱150.00 interest a month, first due
 *   Feb 15, 2027); Nov 20: B pays ₱2,150.00 (interest ₱150.00, principal ₱2,000.00), so installment 1 still
 *   owes ₱500.00, past due from Feb 16, 2027.
 * - Patronage for 2026: A ₱10,000.00, B ₱30,000.00 (₱150.00 interest + ₱29,850.00 store), C ₱2,000.00.
 * - Nov 30: an adjusting entry brings the year's net surplus to exactly `netSurplus`.
 * - January to November closed (their checklists are Phase 14's); December's daily jobs run; the
 *   year-end close on Jan 5, 2027.
 */
export async function surplusFixture(netSurplus: Money) {
  on("2026-01-05");
  const base = await setupServicing();
  users.manager = base.manager.id;
  users.book = base.book.id;
  users.teller = base.teller.id;
  users.clerk = (await makeUser("STORE_CLERK", "clerk1")).id;

  // Paid-up up to the minimum for a regular member is outside the 10% holding cap: raise it while the
  // three members pay up, so the fixture needs no filler shareholders; then back to ₱2,500.00.
  await withTx((tx) => updateSetting(tx, "share.min_paid_up_regular", "10000000", users.manager));
  const a = await member("Alpha");
  const b = await member("Bravo");
  const c = await member("Charlie");
  await shares(a, 120, "12,000.00");
  await goodStanding(b); // 100 shares, ₱2,500.00 paid-up, the membership fee
  await shares(b, 0, "6,500.00");
  await shares(c, 770, "77,000.00");
  await withTx((tx) => updateSetting(tx, "share.min_paid_up_regular", "250000", users.manager));

  on("2026-03-10");
  const sup = await runAs(users.clerk, () => createSupplierAction({ name: "S15 Trading", contact: "0917 000 0000", tin: null, termsDays: 30 }));
  if (!sup.ok) throw new Error(sup.error);
  const prod = await runAs(users.manager, () => createProductAction({ sku: "P15", barcode: null, name: "Rice 1 kg", unit: "pc", categoryId: null, sellingPrice: "50.00", reorderLevel: 5, vatClass: "VAT_EXEMPT" }));
  if (!prod.ok) throw new Error(prod.error);
  const rr = await runAs(users.clerk, () => receiveAction({ supplierId: sup.data.id, poId: null, invoiceNo: "INV-15", payment: "ON_ACCOUNT", lines: [{ productId: prod.data.id, poLineId: null, qty: 900, unitCost: "40.00" }] }));
  if (!rr.ok) throw new Error(rr.error);
  const shift = await runAs(users.clerk, () => openShiftAction({ openingFund: "1,000.00" }));
  if (!shift.ok) throw new Error(shift.error);
  await buy(prod.data.id, a, 200);
  await buy(prod.data.id, b, 597);
  await buy(prod.data.id, c, 40);

  on("2026-11-16");
  const loan = await releasedLoan({ memberId: b, product: "EMR", amount: "10,000.00", term: 4, firstDueDate: "2027-02-15" });
  on("2026-11-20");
  const paid = await payLoan(b, loan.loanId, "2,150.00");
  if (!paid.ok) throw new Error(paid.error);

  // The year's net surplus, exactly.
  on("2026-11-30");
  const current = (await operations("2026-01-01", "2026-12-31")).totals.netSurplus;
  const diff = netSurplus - current;
  if (diff !== 0n) {
    const cash = await accountIdFor("cash_on_hand");
    const other = diff > 0n ? await accountIdFor("service_fee_income") : await accountIdFor("utilities_expense");
    const lines = diff > 0n ? [{ accountId: cash, debit: diff }, { accountId: other, credit: diff }] : [{ accountId: other, debit: -diff }, { accountId: cash, credit: -diff }];
    await withTx((tx) => postJournal(tx, { date: "2026-11-30", book: "GJ", particulars: "Adjusting entry", lines }, users.book));
  }

  // January to November are closed; December's checklist passes once its daily jobs ran.
  await getPool().query("UPDATE periods SET status = 'CLOSED', closed_at = now() WHERE year = 2026 AND month <= 11");
  on("2027-01-05");
  for (let d: BusinessDate = "2026-12-01"; d <= "2026-12-31"; d = addDays(d, 1)) await runDailyJobs(d);
  const closed = await runAs(users.book, () => yearEndCloseAction({ year: 2026 }));
  if (!closed.ok) throw new Error(closed.error);
  return { a, b, c, bLoanId: loan.loanId, bLoanNo: loan.loanNo };
}

/** A member's regular savings account (opened today). */
export async function openSavings(memberId: string): Promise<string> {
  const sav = await productByCode("SAV");
  if (!sav) throw new Error("SAV not seeded");
  const r = await withTx((tx) => openAccount(tx, { memberId, productId: sav.id }, users.manager));
  return r.id;
}

/** Drafts (bookkeeper), approves (manager) and posts (bookkeeper, GA resolution) FY 2026's allocation. */
export async function postedAllocation(year = 2026): Promise<string> {
  const d = await runAs(users.book, () => draftAllocationAction({ year }));
  if (!d.ok) throw new Error(d.error);
  const ap = await runAs(users.manager, () => approveAllocationAction({ allocationId: d.data.id }));
  if (!ap.ok) throw new Error(ap.error);
  const po = await runAs(users.book, () => postAllocationAction({ allocationId: d.data.id, gaResolutionNo: `GA-${year + 1}-07` }));
  if (!po.ok) throw new Error(po.error);
  return d.data.id;
}
