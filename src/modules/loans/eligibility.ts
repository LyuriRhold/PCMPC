import type { Db, Tx } from "@/db/client";
import { format, mulRate, type Money } from "@/lib/money";
import type { members } from "@/modules/members/schema";
import { getSetting } from "@/modules/settings/service";
import { isGoodStanding, shareBalance } from "@/modules/share/service";
import type { EligibilityResult, LoanProduct } from "./schema";

/**
 * Loan eligibility (PHASE-10 T10.4). Each rule returns pass/fail with a message; the results are
 * stored on the application as a snapshot. Past-due checks are hooks: Phase 11 registers the real
 * ones (until then nobody has a loan, so they pass).
 */

type MemberRow = typeof members.$inferSelect;
const nameOf = (m: Pick<MemberRow, "lastName" | "firstName">) => `${m.lastName}, ${m.firstName}`;

export type EligibilityInput = { member: MemberRow; product: LoanProduct; amount: Money; term: number; comakers: MemberRow[] };

/** Returns a message when the member has past-due loans, null otherwise. */
export type PastDueHook = (db: Db | Tx, memberId: string) => Promise<string | null>;

const pastDueHooks = new Map<string, PastDueHook>();

/** Phase 11 registers the past-due check here (a later registration with the same name replaces it). */
export function registerPastDueHook(name: string, hook: PastDueHook): void {
  pastDueHooks.set(name, hook);
}

async function pastDue(db: Db | Tx, memberId: string): Promise<string | null> {
  for (const hook of pastDueHooks.values()) {
    const message = await hook(db, memberId);
    if (message) return message;
  }
  return null;
}

/** The most a member may borrow on a product: its maximum, and its multiple of paid-up share capital. */
export async function loanableAmount(db: Db | Tx, product: LoanProduct, memberId: string): Promise<Money | null> {
  const limits: Money[] = [];
  if (product.maxAmount !== null) limits.push(product.maxAmount);
  if (product.maxMultipleOfPaidUp !== null) limits.push(mulRate((await shareBalance(memberId, db)).paidUp, product.maxMultipleOfPaidUp));
  return limits.length ? limits.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Rules 1–5 of PHASE-10, in order. */
export async function checkEligibility(db: Db | Tx, input: EligibilityInput): Promise<EligibilityResult[]> {
  const { member, product, amount, term, comakers } = input;
  const out: EligibilityResult[] = [];
  const blockPastDue = await getSetting("loan.block_if_past_due", db);

  // 1. ACTIVE and in good standing.
  if (member.status !== "ACTIVE" || !member.memberNo) {
    out.push({ rule: "member", pass: false, message: "Member must be ACTIVE" });
  } else if (!(await isGoodStanding(member.id, db))) {
    const paid = (await shareBalance(member.id, db)).paidUp;
    const min = BigInt(await getSetting("share.min_paid_up_regular", db));
    out.push({ rule: "member", pass: false, message: `Member is not in good standing (paid-up ${format(paid)} of the ${format(min)} minimum, and the membership fee must be paid)` });
  } else {
    out.push({ rule: "member", pass: true, message: "ACTIVE and in good standing" });
  }

  // 2. Within the product maximum and the multiple of paid-up share capital.
  const loanable = await loanableAmount(db, product, member.id);
  if (loanable !== null && amount > loanable) out.push({ rule: "amount", pass: false, message: `Exceeds loanable amount ${format(loanable)}` });
  else out.push({ rule: "amount", pass: true, message: loanable === null ? "No loanable limit" : `Within the loanable amount ${format(loanable)}` });

  // 3. Term within the product's.
  if (term < product.minTerm || term > product.maxTerm) out.push({ rule: "term", pass: false, message: `The term must be ${product.minTerm} to ${product.maxTerm} months` });
  else out.push({ rule: "term", pass: true, message: `${term} months` });

  // 4. No past-due loans (hook; Phase 11).
  const borrowerPastDue = blockPastDue ? await pastDue(db, member.id) : null;
  out.push(borrowerPastDue ? { rule: "past-due", pass: false, message: borrowerPastDue } : { rule: "past-due", pass: true, message: "No past-due loans" });

  // 5. Comakers: enough of them, each an ACTIVE member other than the borrower, none past due.
  const problems: string[] = [];
  if (comakers.some((c) => c.id === member.id)) problems.push("The borrower can't be their own comaker");
  if (new Set(comakers.map((c) => c.id)).size !== comakers.length) problems.push("A comaker is listed twice");
  const others = comakers.filter((c) => c.id !== member.id);
  if (others.length < product.requiredComakers) problems.push(`${product.name} needs ${product.requiredComakers} comaker${product.requiredComakers === 1 ? "" : "s"}`);
  for (const c of others) {
    if (c.status !== "ACTIVE" || !c.memberNo) problems.push(`Comaker ${nameOf(c)} is ${c.status}; comakers must be ACTIVE members`);
    else if (blockPastDue) {
      const due = await pastDue(db, c.id);
      if (due) problems.push(`Comaker ${nameOf(c)}: ${due}`);
    }
  }
  out.push(problems.length ? { rule: "comakers", pass: false, message: problems.join("; ") } : { rule: "comakers", pass: true, message: others.length ? `${others.length} comaker(s): ${others.map(nameOf).join(", ")}` : "No comaker needed" });
  return out;
}
