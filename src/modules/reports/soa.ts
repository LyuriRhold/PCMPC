import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { businessToday } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { accountMappings, journalEntries, journalLines } from "@/modules/ledger/schema";
import { loanProducts } from "@/modules/loans/schema";
import { getLoan, memberLoans } from "@/modules/loans/servicing";
import { members } from "@/modules/members/schema";
import { memberAccounts, memberTimeDeposits } from "@/modules/savings/service";
import { shareBalance } from "@/modules/share/service";
import { memberAr } from "@/modules/store/pos";
import type { Reconciliation } from "./kpis";

/**
 * A member's statement of account (PHASE-16 T16.5): share capital, savings, time deposits, loans
 * (balance and arrears) and what they owe the store, from the member records; each total is
 * checked against the member's lines on the GL control account (the reconciliation).
 */

/** The member's balance (debit − credit) on the accounts mapped to the keys (or keys starting with a prefix). */
async function memberGl(memberId: string, keys: { exact?: string[]; prefix?: string }, db: Db | Tx): Promise<Money> {
  const mapped = db
    .selectDistinct({ id: accountMappings.accountId })
    .from(accountMappings)
    .where(keys.prefix ? sql`starts_with(${accountMappings.key}, ${keys.prefix})` : inArray(accountMappings.key, keys.exact ?? []));
  const [r] = await db
    .select({ s: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(eq(journalLines.memberId, memberId), inArray(journalEntries.status, ["POSTED", "REVERSED"]), inArray(journalLines.accountId, mapped)));
  return BigInt(r?.s ?? "0");
}

export async function memberSoa(memberId: string, db: Db | Tx = getDb()) {
  const [m] = await db.select().from(members).where(eq(members.id, memberId));
  if (!m) throw new Error("member not found");
  const share = await shareBalance(memberId, db);
  const savings = (await memberAccounts(memberId, db))
    .filter((a) => a.product.kind === "SAVINGS")
    .map((a) => ({ accountNo: a.account.accountNo, product: a.product.name, status: a.account.status, balance: a.balance }));
  const tds = (await memberTimeDeposits(memberId, db))
    .filter((t) => t.td.status === "ACTIVE")
    .map((t) => ({ certificateNo: t.td.certificateNo, principal: t.td.principal, ratePa: t.td.ratePa, maturityDate: t.td.maturityDate }));
  const products = new Map((await db.select({ id: loanProducts.id, name: loanProducts.name }).from(loanProducts)).map((p) => [p.id, p.name]));
  const loanRows = [];
  for (const { loan } of await memberLoans(memberId, db)) {
    if (!["ACTIVE", "PAST_DUE"].includes(loan.status)) continue;
    const detail = await getLoan(loan.id, db);
    if (!detail) continue;
    loanRows.push({
      loanNo: loan.loanNo,
      product: products.get(loan.productId) ?? "",
      status: loan.status,
      principal: loan.principal,
      outstandingPrincipal: detail.outstandingPrincipal,
      unpaidInterest: detail.unpaidInterest,
      unpaidPenalty: detail.unpaidPenalty,
      arrears: detail.dueNow,
      daysPastDue: detail.daysPastDue,
    });
  }
  const storeAr = await memberAr(memberId, db);

  const sum = <T>(rows: T[], pick: (r: T) => Money) => rows.reduce((s, r) => s + pick(r), 0n);
  const glSubscribed = -(await memberGl(memberId, { exact: ["subscribed_share_capital_common"] }, db));
  const glReceivable = await memberGl(memberId, { exact: ["subscription_receivable_common"] }, db);
  const glSavings = -(await memberGl(memberId, { exact: ["savings_deposits"] }, db));
  const glTds = -(await memberGl(memberId, { exact: ["time_deposits"] }, db));
  const glLoans = await memberGl(memberId, { prefix: "loans_receivable_" }, db);
  const rec = (label: string, gl: Money, subsidiary: Money): Reconciliation => ({ label, gl, subsidiary, difference: gl - subsidiary });

  return {
    asOf: businessToday(),
    member: { id: m.id, memberNo: m.memberNo, name: [m.lastName, [m.firstName, m.middleName].filter(Boolean).join(" ")].join(", "), type: m.type, status: m.status, membershipDate: m.membershipDate },
    share: { subscribed: share.subscribed, paidUp: share.paidUp, unpaid: share.unpaid },
    savings,
    timeDeposits: tds,
    loans: loanRows,
    storeAr,
    reconciliation: [
      rec("Subscribed share capital", glSubscribed, share.subscribed),
      rec("Subscription receivable", glReceivable, share.unpaid),
      rec("Savings deposits", glSavings, sum(savings, (s) => s.balance)),
      rec("Time deposits", glTds, sum(tds, (t) => t.principal)),
      rec("Loans receivable", glLoans, sum(loanRows, (l) => l.outstandingPrincipal)),
    ],
  };
}

export type MemberSoa = Awaited<ReturnType<typeof memberSoa>>;
