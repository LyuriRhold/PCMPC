import { withTx } from "@/db/client";
import { runDailyJobs } from "@/lib/cron";
import { addDays, setClock, type BusinessDate } from "@/lib/dates";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { makeUser } from "./phase01";
import { applicant, approveAs, createApplicantAs } from "./phase02";
import { P, seedLedger } from "./phase03";

const users = { admin: "", bookkeeper: "", manager: "", teller: "" };

export const fsPeople = () => users;

/** Sets the business date (09:00 Manila). */
export function on(date: BusinessDate): void {
  setClock(() => new Date(`${date}T01:00:00Z`));
}

/** Reference data (incl. the FS lines), FY 2026, today 2026-12-15, and the people who close the books. */
export async function setupFs() {
  await seedLedger();
  on("2026-12-15");
  users.admin = (await makeUser("ADMIN", "admin1")).id;
  users.bookkeeper = (await makeUser("BOOKKEEPER", "book1")).id;
  users.manager = (await makeUser("MANAGER", "mgr1")).id;
  users.teller = (await makeUser("TELLER", "teller1")).id;
  return { ...users };
}

/**
 * The PHASE-14 golden fixture, all via postJournal on 2026-12-15:
 * share capital 100,000; savings 50,000; loan 120,000; interest 18,000; service fees 2,400; store
 * purchases 60,000; store sales 70,000 with COGS 52,000; salaries 15,000; utilities 3,000; savings
 * interest 1,000; loan principal collected 40,000.
 */
export async function postFixture(date: BusinessDate = "2026-12-15") {
  const memberId = await createApplicantAs(users.manager, applicant({ lastName: "Fixture", firstName: "Member", tin: null, validIdNo: "ID-FS1" }));
  await approveAs(users.manager, memberId);
  const k = (key: string) => accountIdFor(key);
  const entries: Array<[string, LineInput[]]> = [
    ["Share capital paid-up", [{ accountId: await k("cash_on_hand"), debit: P(100000) }, { accountId: await k("subscribed_share_capital_common"), credit: P(100000), memberId }]],
    ["Savings deposits", [{ accountId: await k("cash_on_hand"), debit: P(50000) }, { accountId: await k("savings_deposits"), credit: P(50000), memberId }]],
    ["Loan released", [{ accountId: await k("loans_receivable_REG"), debit: P(120000), memberId }, { accountId: await k("cash_on_hand"), credit: P(120000) }]],
    ["Loan interest collected", [{ accountId: await k("cash_on_hand"), debit: P(18000) }, { accountId: await k("interest_income_loans"), credit: P(18000) }]],
    ["Service fees", [{ accountId: await k("cash_on_hand"), debit: P(2400) }, { accountId: await k("service_fee_income"), credit: P(2400) }]],
    ["Store purchases", [{ accountId: await k("merchandise_inventory"), debit: P(60000) }, { accountId: await k("cash_on_hand"), credit: P(60000) }]],
    [
      "Store sales and COGS",
      [
        { accountId: await k("cash_on_hand"), debit: P(70000) },
        { accountId: await k("sales"), credit: P(70000) },
        { accountId: await k("cost_of_sales"), debit: P(52000) },
        { accountId: await k("merchandise_inventory"), credit: P(52000) },
      ],
    ],
    ["Salaries", [{ accountId: await k("salaries_wages"), debit: P(15000) }, { accountId: await k("cash_on_hand"), credit: P(15000) }]],
    ["Utilities", [{ accountId: await k("utilities_expense"), debit: P(3000) }, { accountId: await k("cash_on_hand"), credit: P(3000) }]],
    ["Savings interest", [{ accountId: await k("interest_expense_deposits"), debit: P(1000) }, { accountId: await k("savings_deposits"), credit: P(1000), memberId }]],
    ["Loan principal collected", [{ accountId: await k("cash_on_hand"), debit: P(40000) }, { accountId: await k("loans_receivable_REG"), credit: P(40000), memberId }]],
  ];
  for (const [particulars, lines] of entries) await withTx((tx) => postJournal(tx, { date, book: "GJ", particulars, lines }, users.bookkeeper));
  return { memberId };
}

/** Runs the daily jobs for every date from `from` to `to` (as the cron would have). */
export async function runJobsThrough(from: BusinessDate, to: BusinessDate) {
  for (let d = from; d <= to; d = addDays(d, 1)) await runDailyJobs(d);
}
