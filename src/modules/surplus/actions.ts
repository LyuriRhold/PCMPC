"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { percentToFraction } from "@/lib/rates";
import { CashieringError } from "@/modules/cashiering/builtins";
import { LedgerError } from "@/modules/ledger/service";
import { LoanError } from "@/modules/loans/service";
import { SavingsError } from "@/modules/savings/service";
import { ShareError } from "@/modules/share/service";
import { SurplusError, type SurplusPercents } from "./engine";
import { approveAllocation, distributeAllocation, draftAllocation, postAllocation, setElection } from "./service";

const EXPECTED = [SurplusError, LedgerError, LoanError, SavingsError, ShareError, CashieringError];

/** A percent as typed ("10", "12.5") → a fraction ("0.1", "0.125"). */
function fraction(text: string, what: string): string {
  try {
    return percentToFraction(text.replace("%", ""));
  } catch {
    throw new SurplusError(`Enter the ${what} as a percentage, e.g. 10`);
  }
}

const percent = z.string().trim().max(12).optional();
const draftSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  /** As the GA approved them (percent); left out → the settings. */
  reserve: percent,
  etf: percent,
  cdf: percent,
  optional: percent,
  iscShare: percent,
  prShare: percent,
});
const LABELS: Record<keyof SurplusPercents, string> = {
  reserve: "reserve fund",
  etf: "education and training fund",
  cdf: "community development fund",
  optional: "optional fund",
  iscShare: "interest on share capital share",
  prShare: "patronage refund share",
};

/** Bookkeeper: drafts the year's allocation from its closed net surplus (or recomputes the draft). */
export async function draftAllocationAction(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("surplus.prepare");
  try {
    const data = draftSchema.parse(input);
    const percents: Partial<SurplusPercents> = {};
    for (const key of Object.keys(LABELS) as Array<keyof SurplusPercents>) {
      const typed = data[key];
      if (typed) percents[key] = fraction(typed, LABELS[key]);
    }
    return ok(await withTx((tx) => draftAllocation(tx, { year: data.year, percents }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const idSchema = z.object({ allocationId: z.uuid() });
/** Manager: approves a draft (never the one who prepared it). */
export async function approveAllocationAction(input: z.input<typeof idSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("surplus.approve");
  try {
    const data = idSchema.parse(input);
    await withTx((tx) => approveAllocation(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const postSchema = idSchema.extend({ gaResolutionNo: z.string().trim().max(60) });
/** Bookkeeper: posts an approved allocation with the GA resolution that approved it. */
export async function postAllocationAction(input: z.input<typeof postSchema>): Promise<ActionResult<{ jeId: string }>> {
  const actor = await requirePermission("surplus.prepare");
  try {
    const data = postSchema.parse(input);
    return ok(await withTx((tx) => postAllocation(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const electionSchema = z.object({ lineId: z.uuid(), savings: z.string().trim().max(8), capitalize: z.string().trim().max(8), cash: z.string().trim().max(8) });
/** Bookkeeper: a member's payout election (percent of their net ISC and PR to savings, share capital and cash). */
export async function setElectionAction(input: z.input<typeof electionSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("surplus.prepare");
  try {
    const data = electionSchema.parse(input);
    const bps = (text: string, what: string) => {
      const [i = "0", f = ""] = fraction(text || "0", what).split(".");
      if (f.length > 4) throw new SurplusError(`Enter the ${what} part to 2 decimals at most`);
      return Number(i + f.padEnd(4, "0"));
    };
    await withTx((tx) => setElection(tx, { lineId: data.lineId, savings: bps(data.savings, "savings"), capitalize: bps(data.capitalize, "share capital"), cash: bps(data.cash, "cash") }, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Bookkeeper: pays out a posted allocation (withholding, arrears, savings, share capital, cash DVs). */
export async function distributeAllocationAction(input: z.input<typeof idSchema>): Promise<ActionResult<{ members: number }>> {
  const actor = await requirePermission("surplus.prepare");
  try {
    const data = idSchema.parse(input);
    return ok(await withTx((tx) => distributeAllocation(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
