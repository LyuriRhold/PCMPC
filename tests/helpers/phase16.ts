import { and, eq, sql } from "drizzle-orm";
import { getDb, getPool, withTx } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import type { Money } from "@/lib/money";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { openAccount, productByCode } from "@/modules/savings/service";
import { createProductAction, createSupplierAction, receiveAction } from "@/modules/store/actions";
import { completeSaleAction, openShiftAction } from "@/modules/store/pos-actions";
import { makeUser } from "./phase01";
import { applicant, approveAs, createApplicantAs } from "./phase02";
import { seedLedger } from "./phase03";
import { on, receipt, releasedLoan, setupServicing } from "./phase11";

export { on };

/** A member's subsidiary balance (debit − credit) on the account(s) mapped to `key`, from the GL. */
export async function glSubsidiary(key: string, memberId: string): Promise<Money> {
  const [r] = await getDb()
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .innerJoin(accountMappings, eq(accountMappings.accountId, journalLines.accountId))
    .where(and(eq(accountMappings.key, key), eq(journalLines.memberId, memberId), sql`${journalEntries.status} IN ('POSTED', 'REVERSED')`));
  return BigInt(r?.s ?? "0");
}

/**
 * The A16.3 / A16.6 fixture, Oct 5, 2026: M-000001 in good standing (100 shares, ₱2,500.00 paid
 * up, the membership fee), borrows ₱10,000.00 REG over 12 months (first due Nov 5, 2026; CBU
 * retained ₱200.00), deposits ₱1,500.00 in savings, and charges ₱350.00 at the store.
 */
export async function soaFixture() {
  on("2026-10-05");
  const base = await setupServicing();
  const loan = await releasedLoan({ firstDueDate: "2026-11-05" });
  const sav = await productByCode("SAV");
  if (!sav) throw new Error("SAV not seeded");
  const account = await withTx((tx) => openAccount(tx, { memberId: loan.memberId, productId: sav.id }, base.manager.id));
  const dep = await receipt(loan.memberId, [{ type: "SAVINGS_DEPOSIT", amount: "1,500.00", refId: account.id }]);
  if (!dep.ok) throw new Error(dep.error);
  const clerk = (await makeUser("STORE_CLERK", "clerk1")).id;
  const sup = await runAs(clerk, () => createSupplierAction({ name: "S16 Trading", contact: "0917 000 0000", tin: null, termsDays: 30 }));
  if (!sup.ok) throw new Error(sup.error);
  const prod = await runAs(base.manager.id, () => createProductAction({ sku: "P16", barcode: null, name: "Coffee 3-in-1", unit: "pc", categoryId: null, sellingPrice: "70.00", reorderLevel: 5, vatClass: "VAT_EXEMPT" }));
  if (!prod.ok) throw new Error(prod.error);
  const rr = await runAs(clerk, () => receiveAction({ supplierId: sup.data.id, poId: null, invoiceNo: "INV-16", payment: "ON_ACCOUNT", lines: [{ productId: prod.data.id, poLineId: null, qty: 20, unitCost: "50.00" }] }));
  if (!rr.ok) throw new Error(rr.error);
  const shift = await runAs(clerk, () => openShiftAction({ openingFund: "500.00" }));
  if (!shift.ok) throw new Error(shift.error);
  const sale = await runAs(clerk, () => completeSaleAction({ memberId: loan.memberId, payment: "CHARGE", lines: [{ productId: prod.data.id, qty: 5 }], tendered: null, birInvoiceNo: null }));
  if (!sale.ok) throw new Error(sale.error);
  return { memberId: loan.memberId, loanId: loan.loanId, loanNo: loan.loanNo, savingsAccountId: account.id, manager: base.manager.id, book: base.book.id };
}

/** The A16.2 members: 3 regular male, 2 regular female, 1 associate female (all approved). */
export async function membersFixture() {
  await seedLedger();
  const manager = (await makeUser("MANAGER", "mgr1")).id;
  const people: Array<[string, "REGULAR" | "ASSOCIATE", "MALE" | "FEMALE"]> = [
    ["Uno", "REGULAR", "MALE"],
    ["Dos", "REGULAR", "MALE"],
    ["Tres", "REGULAR", "MALE"],
    ["Cuatro", "REGULAR", "FEMALE"],
    ["Cinco", "REGULAR", "FEMALE"],
    ["Seis", "ASSOCIATE", "FEMALE"],
  ];
  for (const [i, [last, type, sex]] of people.entries()) {
    const id = await createApplicantAs(manager, applicant({ lastName: last, firstName: "Maria", type, sex, birthdate: `1980-01-${String(i + 1).padStart(2, "0")}`, tin: null, validIdNo: `ID-M16-${i}` }));
    await approveAs(manager, id);
  }
  return { manager };
}

/**
 * The T16.6 performance fixture: 1,000 members and 50,000 journal lines (25,000 balanced entries
 * across 2026 on the cash, savings, loan, revenue and expense accounts), written in bulk by SQL.
 */
export async function performanceFixture() {
  await seedLedger();
  const by = (await makeUser("BOOKKEEPER", "book1")).id;
  const pool = getPool();
  await pool.query(
    `INSERT INTO members (member_no, type, status, last_name, first_name, name_key, search_text, birthdate, sex, civil_status, addr_barangay, addr_municipality, addr_province, membership_date, created_by)
     SELECT 'M-' || lpad(g::text, 6, '0'), CASE WHEN g % 10 = 0 THEN 'ASSOCIATE' ELSE 'REGULAR' END, 'ACTIVE', 'Perf' || g, 'Member', 'perf' || g || ' member', 'perf' || g || ' member',
            DATE '1980-01-01' + (g % 3650), CASE WHEN g % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END, 'SINGLE', 'Pipindan', 'Binangonan', 'Rizal', DATE '2025-01-01', $1
     FROM generate_series(1, 1000) g`,
    [by],
  );
  const acct = async (key: string) => (await pool.query<{ id: string }>("SELECT account_id AS id FROM account_mappings WHERE key = $1", [key])).rows[0]!.id;
  const pairs = [
    [await acct("cash_on_hand"), await acct("service_fee_income")],
    [await acct("utilities_expense"), await acct("cash_on_hand")],
    [await acct("cash_in_bank"), await acct("cash_on_hand")],
    [await acct("salaries_wages"), await acct("cash_in_bank")],
  ];
  await pool.query(
    `INSERT INTO journal_entries (id, je_no, book, entry_date, particulars, status, source_module, posted_at, created_by)
     SELECT md5('perf-je-' || g)::uuid, 'GJ-PERF-' || g, 'GJ', DATE '2026-01-01' + (g % 365), 'Performance fixture ' || g, 'POSTED', 'perf_fixture', now(), $1
     FROM generate_series(1, 25000) g`,
    [by],
  );
  for (const [i, [dr, cr]] of pairs.entries()) {
    await pool.query(
      `INSERT INTO journal_lines (je_id, line_no, account_id, debit, credit, created_by)
       SELECT md5('perf-je-' || g)::uuid, 1, $1, 1000 + (g % 997) * 100, 0, $3 FROM generate_series(1, 25000) g WHERE g % 4 = $4
       UNION ALL
       SELECT md5('perf-je-' || g)::uuid, 2, $2, 0, 1000 + (g % 997) * 100, $3 FROM generate_series(1, 25000) g WHERE g % 4 = $4`,
      [dr, cr, by, i],
    );
  }
}
