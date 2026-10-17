import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { businessToday, type BusinessDate } from "@/lib/dates";
import { allocate, format, mulRate, type Money } from "@/lib/money";
import { yearEndCloses } from "@/modules/accounting/schema";
import { disbursementVouchers, type DvMode } from "@/modules/cashiering/schema";
import { createDv } from "@/modules/cashiering/service";
import { fiscalYears } from "@/modules/ledger/schema";
import { accountIdFor, postJournal, type LineInput } from "@/modules/ledger/service";
import { loanInterestPaid, loanPaymentLines, pastDueLoans, planLoanPayment, recordLoanPayment, type LoanPaymentPlan } from "@/modules/loans/servicing";
import { members, type MemberStatus } from "@/modules/members/schema";
import { checkTransferIn, depositableAccounts, recordTransfer, savingsGlAccountId } from "@/modules/savings/service";
import { getSetting } from "@/modules/settings/service";
import { averageShareMonthFrom, capitalizeIscPr, cbuLines } from "@/modules/share/service";
import { storePatronageBetween } from "@/modules/store/pos";
import { waterBillsPaid } from "@/modules/water/reports";
import { patronageOf, sharePool, splitSurplus, SurplusError, weightsOf, type SurplusPercents, type SurplusSplit } from "./engine";
import { cetfRemittances, surplusAllocations, surplusMemberLines, type AllocationStatus, type PrBasis, type SurplusAllocation, type SurplusMemberLine } from "./schema";

/**
 * Net surplus allocation (PHASE-15): who shares the year's ISC and PR, and how much (T15.3); the
 * workflow: draft → approve → post → distribute (T15.4).
 * ISC is shared by ASM (share.asm_basis, Phase 08); PR by patronage: loan interest paid (Phase 11),
 * net store purchases (Phase 13) and, if the basis says so, water bills paid (surplus.pr_basis), all
 * over the fiscal year's own months.
 */

/** Members who share ISC and PR: active and inactive members (CONFIRM Q-15.2); applicants, terminated and deceased members don't. */
const ELIGIBLE: MemberStatus[] = ["ACTIVE", "INACTIVE"];

export type Entitlement = { memberId: string; asm: Money; loanInterest: Money; store: Money; water: Money; patronage: Money };

/** Each eligible member's ASM and patronage for a fiscal year; members with neither are left out. */
export async function memberEntitlements(fy: { year: number; startDate: BusinessDate; endDate: BusinessDate }, basis: PrBasis, db: Db | Tx = getDb()): Promise<Entitlement[]> {
  const rows = await db.select({ id: members.id }).from(members).where(inArray(members.status, ELIGIBLE)).orderBy(asc(members.memberNo));
  const out: Entitlement[] = [];
  for (const { id } of rows) {
    const asm = await averageShareMonthFrom(id, fy.startDate, db);
    const loanInterest = await loanInterestPaid(id, fy.startDate, fy.endDate, db);
    const store = await storePatronageBetween(id, fy.startDate, fy.endDate, db);
    const water = await waterBillsPaid(id, fy.startDate, fy.endDate, db);
    const patronage = patronageOf({ loanInterest, store, water }, basis);
    if (asm > 0n || patronage > 0n) out.push({ memberId: id, asm, loanInterest, store, water, patronage });
  }
  return out;
}

export type MemberShare = Entitlement & { isc: Money; pr: Money; gross: Money };

/**
 * Each member's ISC (the ISC pool by ASM) and PR (the PR pool by patronage), each split with
 * allocate so the members' amounts add up to the pools exactly; members with nothing are left out.
 */
export function memberShares(year: number, split: Pick<SurplusSplit, "iscPool" | "prPool">, entitlements: Entitlement[]): { iscRate: string; prRate: string; lines: MemberShare[] } {
  if (split.iscPool > 0n && !entitlements.some((e) => e.asm > 0n)) throw new SurplusError(`No member had share capital in ${year} to share the interest on share capital`);
  if (split.prPool > 0n && !entitlements.some((e) => e.patronage > 0n)) throw new SurplusError(`No member had patronage in ${year} to share the patronage refund`);
  const isc = sharePool(split.iscPool, entitlements.map((e) => e.asm));
  const pr = sharePool(split.prPool, entitlements.map((e) => e.patronage));
  const lines = entitlements
    .map((e, i) => {
      const memberIsc = isc.amounts[i] ?? 0n;
      const memberPr = pr.amounts[i] ?? 0n;
      return { ...e, isc: memberIsc, pr: memberPr, gross: memberIsc + memberPr };
    })
    .filter((l) => l.gross > 0n);
  return { iscRate: isc.rate, prRate: pr.rate, lines };
}

// ── Workflow (T15.4): draft → approve → post → distribute ──

const FUND_KEYS = [
  ["reserve", "reserve_fund"],
  ["etfLocal", "education_training_fund"],
  ["cetf", "cetf_payable"],
  ["cdf", "community_development_fund"],
  ["optional", "optional_fund"],
  ["iscPool", "isc_payable"],
  ["prPool", "patronage_refund_payable"],
] as const;

const reference = (year: number) => `NSA-${year}`;
/** Payout fractions (adding up to 1) in basis points adding up to exactly 10000. */
const toBps = (fractions: string[]): number[] => allocate(10000n, weightsOf(fractions)).map((b) => Number(b));

/** One allocation workflow step per fiscal year at a time. */
const lockYear = (tx: Tx, year: number) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`surplus:${year}`}))`);

async function lockAllocation(tx: Tx, allocationId: string): Promise<SurplusAllocation> {
  const [a] = await tx.select().from(surplusAllocations).where(eq(surplusAllocations.id, allocationId)).for("update");
  if (!a) throw new SurplusError("Allocation not found");
  return a;
}

const statusWord = (s: AllocationStatus) => s.toLowerCase();

/**
 * Drafts the year's allocation (or recomputes the draft): the year's net surplus (its year-end
 * close) split by the percentages (the settings, or as the GA approved them), and each member's ISC
 * and PR. Members' elections made on an earlier draft are kept; others get the default payout.
 */
export async function draftAllocation(tx: Tx, input: { year: number; percents?: Partial<SurplusPercents> }, actorId: string) {
  const year = input.year;
  await lockYear(tx, year);
  const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.year, year));
  if (!fy) throw new SurplusError(`Fiscal year ${year} isn't set up`);
  if (fy.status !== "CLOSED") throw new SurplusError(`Close fiscal year ${year} first (the year-end close, on Period close)`);
  const [closing] = await tx.select().from(yearEndCloses).where(eq(yearEndCloses.year, year));
  if (!closing) throw new SurplusError(`Fiscal year ${year} has no year-end close`);
  if (closing.netSurplus <= 0n) throw new SurplusError(`Fiscal year ${year} closed with no net surplus (${format(closing.netSurplus)}); there is nothing to allocate`);
  const [existing] = await tx.select().from(surplusAllocations).where(eq(surplusAllocations.fiscalYear, year)).for("update");
  if (existing && existing.status !== "DRAFT") throw new SurplusError(`Fiscal year ${year}'s allocation is already ${statusWord(existing.status)}`);

  // Percentages not given: the draft's own (as the GA approved them), or the settings for a first draft.
  const percents: SurplusPercents = {
    reserve: input.percents?.reserve ?? existing?.reservePct ?? (await getSetting("surplus.reserve_pct", tx)),
    etf: input.percents?.etf ?? existing?.etfPct ?? (await getSetting("surplus.etf_pct", tx)),
    cdf: input.percents?.cdf ?? existing?.cdfPct ?? (await getSetting("surplus.cdf_pct", tx)),
    optional: input.percents?.optional ?? existing?.optionalPct ?? (await getSetting("surplus.optional_pct", tx)),
    iscShare: input.percents?.iscShare ?? existing?.iscShare ?? (await getSetting("surplus.isc_share_of_remaining", tx)),
    prShare: input.percents?.prShare ?? existing?.prShare ?? (await getSetting("surplus.pr_share_of_remaining", tx)),
  };
  const split = splitSurplus(closing.netSurplus, percents);
  const basis = await getSetting("surplus.pr_basis", tx);
  const shares = memberShares(year, split, await memberEntitlements(fy, basis, tx));
  const values = {
    fiscalYear: year,
    netSurplus: split.netSurplus,
    reservePct: percents.reserve,
    etfPct: percents.etf,
    cdfPct: percents.cdf,
    optionalPct: percents.optional,
    iscShare: percents.iscShare,
    prShare: percents.prShare,
    prBasis: basis,
    wtaxRate: await getSetting("surplus.isc_pr_wtax_rate", tx),
    offsetArrears: await getSetting("surplus.offset_arrears_first", tx),
    reserve: split.reserve,
    etfLocal: split.etfLocal,
    cetf: split.cetf,
    cdf: split.cdf,
    optional: split.optional,
    remaining: split.remaining,
    iscPool: split.iscPool,
    prPool: split.prPool,
    iscRate: shares.iscRate,
    prRate: shares.prRate,
    preparedBy: actorId,
  };
  let id: string;
  const kept = new Map<string, Pick<SurplusMemberLine, "electSavings" | "electCapitalize" | "electCash">>();
  if (existing) {
    for (const l of await tx.select().from(surplusMemberLines).where(eq(surplusMemberLines.allocationId, existing.id))) {
      kept.set(l.memberId, { electSavings: l.electSavings, electCapitalize: l.electCapitalize, electCash: l.electCash });
    }
    await tx.delete(surplusMemberLines).where(eq(surplusMemberLines.allocationId, existing.id));
    await tx.update(surplusAllocations).set({ ...values, revision: existing.revision + 1 }).where(eq(surplusAllocations.id, existing.id));
    id = existing.id;
  } else {
    const [a] = await tx
      .insert(surplusAllocations)
      .values({ ...values, createdBy: actorId })
      .returning();
    if (!a) throw new Error("allocation insert returned no row");
    id = a.id;
  }
  const payout = await getSetting("surplus.default_payout", tx);
  const [dSavings = 10000, dCapital = 0, dCash = 0] = toBps([payout.savings, payout.capitalize, payout.cash]);
  const byDefault = { electSavings: dSavings, electCapitalize: dCapital, electCash: dCash };
  if (shares.lines.length) {
    await tx.insert(surplusMemberLines).values(
      shares.lines.map((l) => ({
        allocationId: id,
        memberId: l.memberId,
        asm: l.asm,
        isc: l.isc,
        patronageLoanInterest: l.loanInterest,
        patronageStore: l.store,
        patronageWater: l.water,
        patronageTotal: l.patronage,
        pr: l.pr,
        gross: l.gross,
        ...(kept.get(l.memberId) ?? byDefault),
        net: l.gross,
        createdBy: actorId,
      })),
    );
  }
  await audit(tx, {
    action: existing ? "surplus.redraft" : "surplus.draft",
    entity: "surplus_allocation",
    entityId: id,
    after: { year, netSurplus: format(split.netSurplus), percents, iscPool: format(split.iscPool), prPool: format(split.prPool), members: shares.lines.length },
    userId: actorId,
  });
  return { id };
}

/** The manager approves a draft (never the one who prepared it); with `revision`, only the figures they looked at. */
export async function approveAllocation(tx: Tx, input: { allocationId: string; revision?: number }, managerId: string) {
  const a = await lockAllocation(tx, input.allocationId);
  if (a.status !== "DRAFT") throw new SurplusError(`Fiscal year ${a.fiscalYear}'s allocation is already ${statusWord(a.status)}`);
  if (a.preparedBy === managerId) throw new SurplusError("The one who prepared the allocation can't approve it");
  if (input.revision !== undefined && input.revision !== a.revision) throw new SurplusError("The draft was recomputed after you opened it; look at the new figures and approve again");
  await tx.update(surplusAllocations).set({ status: "APPROVED", approvedBy: managerId, approvedAt: sql`now()` }).where(eq(surplusAllocations.id, a.id));
  await audit(tx, { action: "surplus.approve", entity: "surplus_allocation", entityId: a.id, after: { year: a.fiscalYear }, userId: managerId });
}

/** The manager sends an approved allocation back to draft (e.g. the GA changed the percentages), with a reason. */
export async function returnToDraft(tx: Tx, input: { allocationId: string; reason: string }, managerId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new SurplusError("Enter why the allocation goes back to draft");
  const a = await lockAllocation(tx, input.allocationId);
  if (a.status !== "APPROVED") throw new SurplusError(a.status === "DRAFT" ? `Fiscal year ${a.fiscalYear}'s allocation is a draft` : `Fiscal year ${a.fiscalYear}'s allocation is already ${statusWord(a.status)}`);
  await tx.update(surplusAllocations).set({ status: "DRAFT", approvedBy: null, approvedAt: null }).where(eq(surplusAllocations.id, a.id));
  await audit(tx, { action: "surplus.return_to_draft", entity: "surplus_allocation", entityId: a.id, before: { status: "APPROVED", approvedBy: a.approvedBy }, after: { status: "DRAFT", reason }, userId: managerId });
}

/**
 * Posts an approved allocation once the General Assembly approved it (its resolution no.): Dr
 * Undivided Net Surplus / Cr the funds, CETF payable, ISC payable and PR payable.
 */
export async function postAllocation(tx: Tx, input: { allocationId: string; gaResolutionNo: string }, actorId: string) {
  const ga = input.gaResolutionNo.trim();
  if (!ga) throw new SurplusError("Enter the General Assembly resolution no. that approved the allocation");
  const a = await lockAllocation(tx, input.allocationId);
  if (a.status === "DRAFT") throw new SurplusError(`Fiscal year ${a.fiscalYear}'s allocation isn't approved yet`);
  if (a.status !== "APPROVED") throw new SurplusError(`Fiscal year ${a.fiscalYear}'s allocation is already ${statusWord(a.status)}`);
  const [sums] = await tx
    .select({ isc: sql<string>`coalesce(sum(${surplusMemberLines.isc}), 0)::text`, pr: sql<string>`coalesce(sum(${surplusMemberLines.pr}), 0)::text` })
    .from(surplusMemberLines)
    .where(eq(surplusMemberLines.allocationId, a.id));
  if (BigInt(sums?.isc ?? "0") !== a.iscPool || BigInt(sums?.pr ?? "0") !== a.prPool) throw new SurplusError("The members' ISC and PR don't add up to the pools; send it back to draft and recompute");
  const lines: LineInput[] = [{ accountId: await accountIdFor("undivided_net_surplus", tx), debit: a.netSurplus, memo: `Net surplus ${a.fiscalYear}` }];
  for (const [field, key] of FUND_KEYS) if (a[field] > 0n) lines.push({ accountId: await accountIdFor(key, tx), credit: a[field], memo: `Net surplus ${a.fiscalYear}` });
  const je = await postJournal(
    tx,
    { date: businessToday(), book: "GJ", particulars: `Allocation of the net surplus of fiscal year ${a.fiscalYear} (GA resolution ${ga})`, reference: reference(a.fiscalYear), source: { module: "surplus", id: a.id }, lines },
    actorId,
  );
  await tx.update(surplusAllocations).set({ status: "POSTED", gaResolutionNo: ga, postedBy: actorId, postedAt: sql`now()`, jeId: je.id }).where(eq(surplusAllocations.id, a.id));
  await audit(tx, { action: "surplus.post", entity: "surplus_allocation", entityId: a.id, after: { year: a.fiscalYear, gaResolutionNo: ga, jeId: je.id }, userId: actorId });
  return { jeId: je.id };
}

/** A member's payout election (basis points adding up to 10000), until their line is distributed. */
export async function setElection(tx: Tx, input: { lineId: string; savings: number; capitalize: number; cash: number }, actorId: string) {
  const parts = [input.savings, input.capitalize, input.cash];
  if (parts.some((p) => !Number.isSafeInteger(p) || p < 0) || parts.reduce((s, p) => s + p, 0) !== 10000) throw new SurplusError("The payout parts add up to 100%");
  // The allocation first, then the line: the same order as recomputing and distributing.
  const [found] = await tx.select({ allocationId: surplusMemberLines.allocationId }).from(surplusMemberLines).where(eq(surplusMemberLines.id, input.lineId));
  if (!found) throw new SurplusError("Member line not found");
  const a = await lockAllocation(tx, found.allocationId);
  const [line] = await tx.select().from(surplusMemberLines).where(eq(surplusMemberLines.id, input.lineId)).for("update");
  if (!line) throw new SurplusError("Member line not found");
  if (a.status === "DISTRIBUTED" || line.distributedAt) throw new SurplusError("This member's ISC and patronage refund were already paid out");
  await tx.update(surplusMemberLines).set({ electSavings: input.savings, electCapitalize: input.capitalize, electCash: input.cash }).where(eq(surplusMemberLines.id, line.id));
  await audit(tx, { action: "surplus.election", entity: "surplus_member_line", entityId: line.id, before: { savings: line.electSavings, capitalize: line.electCapitalize, cash: line.electCash }, after: { savings: input.savings, capitalize: input.capitalize, cash: input.cash }, userId: actorId });
}

type Source = { accountId: string; kind: "isc" | "pr"; left: Money };

/** Takes `amount` from the payables, ISC first then PR: the debit lines (and how much came from each). */
function draw(sources: Source[], amount: Money, memberId: string, memo: string): { lines: LineInput[]; isc: Money; pr: Money } {
  const lines: LineInput[] = [];
  const took = { isc: 0n, pr: 0n };
  let need = amount;
  for (const s of sources) {
    if (need === 0n) break;
    const take = s.left < need ? s.left : need;
    if (take === 0n) continue;
    s.left -= take;
    need -= take;
    took[s.kind] += take;
    lines.push({ accountId: s.accountId, debit: take, memberId, memo });
  }
  if (need !== 0n) throw new Error("payout exceeds the member's ISC and PR");
  return { lines, ...took };
}

/**
 * Pays out a posted allocation, member by member (one entry each, dated today): withholding tax
 * (surplus.isc_pr_wtax_rate), then, if the allocation offsets arrears, the member's past-due loan
 * amounts as a loan payment; what is left goes by their election to savings, to share capital and
 * in cash (a disbursement voucher, released by a teller). Each payout is drawn from ISC payable
 * first, then PR payable.
 */
export async function distributeAllocation(tx: Tx, input: { allocationId: string }, actorId: string) {
  const a = await lockAllocation(tx, input.allocationId);
  if (a.status === "DRAFT" || a.status === "APPROVED") throw new SurplusError(`Post fiscal year ${a.fiscalYear}'s allocation first`);
  if (a.status === "DISTRIBUTED") throw new SurplusError(`Fiscal year ${a.fiscalYear}'s allocation is already distributed`);
  const rows = await tx
    .select({ line: surplusMemberLines, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName })
    .from(surplusMemberLines)
    .innerJoin(members, eq(members.id, surplusMemberLines.memberId))
    .where(eq(surplusMemberLines.allocationId, a.id))
    .orderBy(asc(members.memberNo))
    .for("update", { of: surplusMemberLines });
  // Every member who elected savings needs an account that can take it.
  const savingsOf = new Map<string, string>();
  const missing: string[] = [];
  for (const r of rows) {
    if (r.line.electSavings === 0) continue;
    const [acct] = await depositableAccounts(r.line.memberId, tx);
    if (acct) savingsOf.set(r.line.memberId, acct.id);
    else missing.push(`${r.memberNo} ${r.firstName} ${r.lastName}`);
  }
  if (missing.length) throw new SurplusError(`These members chose savings but have no savings account; open one or change their payout: ${missing.join(", ")}`);

  const today = businessToday();
  const ref = reference(a.fiscalYear);
  const [iscPayable, prPayable, wtaxPayable] = [await accountIdFor("isc_payable", tx), await accountIdFor("patronage_refund_payable", tx), await accountIdFor("withholding_tax_payable", tx)];
  let paid = 0;
  for (const { line, memberNo, lastName, firstName } of rows) {
    // The member first (as at the teller and on loan releases), then their loans, savings and capital.
    await tx.select({ id: members.id }).from(members).where(eq(members.id, line.memberId)).for("update");
    const name = `${firstName} ${lastName}`;
    const memo = `ISC/PR ${a.fiscalYear} · ${memberNo}`;
    const sources: Source[] = [
      { accountId: iscPayable, kind: "isc", left: line.isc },
      { accountId: prPayable, kind: "pr", left: line.pr },
    ];
    const debits: LineInput[] = [];
    const credits: LineInput[] = [];
    // Withholding tax, HALF-UP on each of ISC and PR (default 0%, CONFIRM).
    const wtax = mulRate(line.isc, a.wtaxRate) + mulRate(line.pr, a.wtaxRate);
    if (wtax > 0n) {
      debits.push(...draw(sources, wtax, line.memberId, memo).lines);
      credits.push({ accountId: wtaxPayable, credit: wtax, memo });
    }
    // Arrears first: past-due amounts on the member's loans, oldest loan first, as a loan payment.
    const plans: LoanPaymentPlan[] = [];
    let offset = 0n;
    if (a.offsetArrears) {
      let left = line.gross - wtax;
      for (const due of await pastDueLoans(line.memberId, today, tx)) {
        if (left === 0n) break;
        const take = due.amount < left ? due.amount : left;
        const plan = await planLoanPayment(tx, due.loanId, take, "OFFSET");
        plans.push(plan);
        credits.push(...(await loanPaymentLines(tx, plan)));
        offset += take;
        left -= take;
      }
      if (offset > 0n) debits.push(...draw(sources, offset, line.memberId, memo).lines);
    }
    const net = line.gross - wtax - offset;
    const [toSavings, toCapital, toCash] = net > 0n ? (allocate(net, [line.electSavings, line.electCapitalize, line.electCash]) as [Money, Money, Money]) : [0n, 0n, 0n];
    const savingsAccountId = toSavings > 0n ? (savingsOf.get(line.memberId) ?? null) : null;
    if (toSavings > 0n && savingsAccountId) {
      await checkTransferIn(tx, { accountId: savingsAccountId, memberId: line.memberId });
      debits.push(...draw(sources, toSavings, line.memberId, memo).lines);
      credits.push({ accountId: await savingsGlAccountId(tx, savingsAccountId), credit: toSavings, memberId: line.memberId, memo });
    }
    let capitalParts = { isc: 0n, pr: 0n };
    if (toCapital > 0n) {
      const d = draw(sources, toCapital, line.memberId, memo);
      debits.push(...d.lines);
      capitalParts = { isc: d.isc, pr: d.pr };
      credits.push(...(await cbuLines(tx, line.memberId, toCapital, "have ISC or patronage refund capitalized")));
    }
    let jeId: string | null = null;
    if (debits.length) {
      const je = await postJournal(
        tx,
        { date: today, book: "GJ", particulars: `Interest on share capital and patronage refund ${a.fiscalYear}: ${memberNo} ${name}`, reference: ref, source: { module: "surplus", id: line.id }, lines: [...debits, ...credits] },
        actorId,
      );
      jeId = je.id;
      for (const plan of plans) await recordLoanPayment(tx, plan, { payDate: today, jeId, refNo: ref, remarks: `Offset from ISC/patronage refund ${a.fiscalYear}` }, actorId);
      if (toSavings > 0n && savingsAccountId) await recordTransfer(tx, { accountId: savingsAccountId, amount: toSavings, date: today, jeId, refNo: ref, remarks: `ISC and patronage refund ${a.fiscalYear}` }, actorId);
      if (toCapital > 0n) await capitalizeIscPr(tx, line.memberId, capitalParts, { jeId, ref }, actorId);
    }
    // Cash: what is left of the payables goes out by a disbursement voucher (approved by the manager, released by a teller).
    let dvId: string | null = null;
    if (toCash > 0n) {
      const d = draw(sources, toCash, line.memberId, memo);
      const dv = await createDv(
        tx,
        { date: today, payee: name, particulars: `Interest on share capital and patronage refund ${a.fiscalYear} (${memberNo})`, mode: "CASH", checkNo: null, lines: d.lines.map((l) => ({ accountId: l.accountId, memberId: line.memberId, amount: l.debit ?? 0n, memo })) },
        actorId,
      );
      dvId = dv.id;
    }
    await tx
      .update(surplusMemberLines)
      .set({ wtax, arrearsOffset: offset, net, payoutSavings: toSavings, payoutCapitalize: toCapital, payoutCash: toCash, savingsAccountId, jeId, dvId, distributedAt: sql`now()` })
      .where(eq(surplusMemberLines.id, line.id));
    paid += 1;
  }
  await tx.update(surplusAllocations).set({ status: "DISTRIBUTED", distributedBy: actorId, distributedAt: sql`now()` }).where(eq(surplusAllocations.id, a.id));
  await audit(tx, { action: "surplus.distribute", entity: "surplus_allocation", entityId: a.id, after: { year: a.fiscalYear, members: paid }, userId: actorId });
  return { members: paid };
}

// ── CETF (T15.5): the half of the ETF owed to the federation/union, remitted by disbursement voucher ──

export type CetfRow = { allocationId: string; fiscalYear: number; cetf: Money; remitted: Money; pending: Money; toRemit: Money };

/** Remittances of an allocation's CETF by their DV's status: released (remitted) or not yet (pending); cancelled ones don't count. */
async function cetfOf(db: Db | Tx, allocationId: string) {
  const rows = await db
    .select({ amount: cetfRemittances.amount, status: disbursementVouchers.status })
    .from(cetfRemittances)
    .innerJoin(disbursementVouchers, eq(disbursementVouchers.id, cetfRemittances.dvId))
    .where(eq(cetfRemittances.allocationId, allocationId));
  const sumOf = (pred: (s: string) => boolean) => rows.filter((r) => pred(r.status)).reduce((s, r) => s + r.amount, 0n);
  return { remitted: sumOf((s) => s === "RELEASED"), pending: sumOf((s) => s === "DRAFT" || s === "APPROVED") };
}

/** The CETF payable report: each posted year's CETF, what was remitted, what is on a DV not yet released, and what is left. */
export async function cetfReport(db: Db | Tx = getDb()): Promise<CetfRow[]> {
  const posted = await db.select().from(surplusAllocations).where(inArray(surplusAllocations.status, ["POSTED", "DISTRIBUTED"])).orderBy(desc(surplusAllocations.fiscalYear));
  const out: CetfRow[] = [];
  for (const a of posted) {
    const { remitted, pending } = await cetfOf(db, a.id);
    out.push({ allocationId: a.id, fiscalYear: a.fiscalYear, cetf: a.cetf, remitted, pending, toRemit: a.cetf - remitted - pending });
  }
  return out;
}

/** Prepares the remittance of a posted year's CETF to the federation/union: a DV (Dr CETF payable), approved by the manager and released as usual. */
export async function remitCetf(tx: Tx, input: { allocationId: string; amount: Money; payee: string; mode: DvMode; checkNo: string | null }, actorId: string) {
  const payee = input.payee.trim();
  if (!payee) throw new SurplusError("Enter the federation or union the CETF is remitted to");
  const a = await lockAllocation(tx, input.allocationId);
  if (a.status === "DRAFT" || a.status === "APPROVED") throw new SurplusError(`Post fiscal year ${a.fiscalYear}'s allocation first`);
  if (input.amount <= 0n) throw new SurplusError("The amount must be more than zero");
  const { remitted, pending } = await cetfOf(tx, a.id);
  const left = a.cetf - remitted - pending;
  if (input.amount > left) throw new SurplusError(`Only ${format(left)} of fiscal year ${a.fiscalYear}'s CETF is left to remit`);
  const dv = await createDv(
    tx,
    {
      date: businessToday(),
      payee,
      particulars: `CETF of fiscal year ${a.fiscalYear} remitted to ${payee}`,
      mode: input.mode,
      checkNo: input.checkNo,
      lines: [{ accountId: await accountIdFor("cetf_payable", tx), memberId: null, amount: input.amount, memo: `CETF ${a.fiscalYear}` }],
    },
    actorId,
  );
  await tx.insert(cetfRemittances).values({ allocationId: a.id, dvId: dv.id, amount: input.amount, createdBy: actorId });
  await audit(tx, { action: "surplus.cetf_remit", entity: "surplus_allocation", entityId: a.id, after: { year: a.fiscalYear, amount: format(input.amount), payee, dvNo: dv.dvNo }, userId: actorId });
  return { dvId: dv.id, dvNo: dv.dvNo };
}

// ── Queries ──

/** A year's allocation (or null). */
export async function allocationOfYear(year: number, db: Db | Tx = getDb()) {
  const [a] = await db.select().from(surplusAllocations).where(eq(surplusAllocations.fiscalYear, year));
  return a ?? null;
}

export async function getAllocation(allocationId: string, db: Db | Tx = getDb()) {
  const [a] = await db.select().from(surplusAllocations).where(eq(surplusAllocations.id, allocationId));
  return a ?? null;
}

/** Every allocation, latest year first. */
export async function listAllocations(db: Db | Tx = getDb()) {
  return db.select().from(surplusAllocations).orderBy(desc(surplusAllocations.fiscalYear));
}

/** An allocation's member lines with the member no. and name (the per-member list for the GA), by member no. */
export async function allocationLines(allocationId: string, db: Db | Tx = getDb()) {
  const rows = await db
    .select({ line: surplusMemberLines, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName, middleName: members.middleName })
    .from(surplusMemberLines)
    .innerJoin(members, eq(members.id, surplusMemberLines.memberId))
    .where(eq(surplusMemberLines.allocationId, allocationId))
    .orderBy(asc(members.memberNo));
  return rows.map((r) => ({ ...r.line, memberNo: r.memberNo, name: [r.lastName, [r.firstName, r.middleName].filter(Boolean).join(" ")].join(", ") }));
}
