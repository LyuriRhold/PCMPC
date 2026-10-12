import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { getSetting } from "@/modules/settings/service";
import { loanProductDeductions, loanProducts, type DeductionBasis, type DeductionCode, type LoanMethod } from "./schema";

type Sample = {
  code: string;
  name: string;
  method: LoanMethod;
  ratePm: string;
  minTerm: number;
  maxTerm: number;
  /** CONFIRM Q-10.9. */
  minAmount: bigint;
  maxAmount: bigint | null;
  maxMultipleOfPaidUp: string | null;
  /** CONFIRM Q-10.1: DOMAIN §2 gives no comaker rule. */
  requiredComakers: number;
  deductions: Array<{ code: DeductionCode; name: string; basis: DeductionBasis; value: string; glKey: string }>;
};

const serviceFee = (rate: string) => ({ code: "SERVICE_FEE" as const, name: "Service fee", basis: "PCT_OF_PRINCIPAL" as const, value: rate, glKey: "service_fee_income" });
const cbu = { code: "CBU" as const, name: "CBU (share capital)", basis: "PCT_OF_PRINCIPAL" as const, value: "0.02", glKey: "subscription_receivable_common" };
const notarial = { code: "NOTARIAL" as const, name: "Notarial fee", basis: "FIXED" as const, value: "10000", glKey: "notarial_fee_income" };

/** DOMAIN §2 "Sample loan products" (all CONFIRM, to be replaced by the PCMPC loan policy). */
export const SAMPLE_LOAN_PRODUCTS: Sample[] = [
  { code: "REG", name: "Regular Loan", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", minTerm: 6, maxTerm: 24, minAmount: 100_000n, maxAmount: null, maxMultipleOfPaidUp: "3", requiredComakers: 1, deductions: [serviceFee("0.02"), cbu, notarial] },
  { code: "EMR", name: "Emergency Loan", method: "ADD_ON", ratePm: "0.015", minTerm: 1, maxTerm: 6, minAmount: 100_000n, maxAmount: 1_000_000n, maxMultipleOfPaidUp: null, requiredComakers: 0, deductions: [serviceFee("0.01")] },
  { code: "PRD", name: "Productive/Livelihood Loan", method: "DIMINISHING_EQUAL_PRINCIPAL", ratePm: "0.01", minTerm: 6, maxTerm: 12, minAmount: 100_000n, maxAmount: 5_000_000n, maxMultipleOfPaidUp: null, requiredComakers: 1, deductions: [serviceFee("0.02"), cbu] },
];

/** Loan products and their deductions. Idempotent: products that exist are left as they are. */
export async function seedLoanProducts(tx: Tx): Promise<void> {
  const penalty = await getSetting("loan.penalty_rate_pm", tx);
  const graceDays = await getSetting("loan.grace_days", tx);
  for (const s of SAMPLE_LOAN_PRODUCTS) {
    const [created] = await tx
      .insert(loanProducts)
      .values({
        code: s.code,
        name: s.name,
        method: s.method,
        ratePm: s.ratePm,
        minTerm: s.minTerm,
        maxTerm: s.maxTerm,
        minAmount: s.minAmount,
        maxAmount: s.maxAmount,
        maxMultipleOfPaidUp: s.maxMultipleOfPaidUp,
        requiredComakers: s.requiredComakers,
        penaltyRatePm: penalty.ratePerMonth,
        graceDays,
        receivableGlKey: `loans_receivable_${s.code}`,
      })
      .onConflictDoNothing({ target: loanProducts.code })
      .returning({ id: loanProducts.id });
    if (!created) continue;
    const [existing] = await tx.select({ id: loanProductDeductions.id }).from(loanProductDeductions).where(eq(loanProductDeductions.productId, created.id)).limit(1);
    if (existing) continue;
    await tx.insert(loanProductDeductions).values(s.deductions.map((d, i) => ({ ...d, productId: created.id, sort: i })));
  }
}
