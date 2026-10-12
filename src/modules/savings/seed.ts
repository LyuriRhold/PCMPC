import type { Tx } from "@/db/client";
import { getSetting } from "@/modules/settings/service";
import { depositProducts } from "./schema";

/** Time-deposit rate until PCMPC sends its TD rates (CONFIRM Q-09.2; DOMAIN §2 has none). */
export const DEFAULT_TD_RATE_PA = "0.03";

/**
 * Deposit products (all CONFIRM): Regular Savings from the DOMAIN §2 savings defaults, and one
 * Time Deposit product. From here on the products are the configuration (Savings products page).
 * Idempotent: existing products are left as they are.
 */
export async function seedDepositProducts(tx: Tx): Promise<void> {
  const wtaxRate = await getSetting("savings.wtax_rate", tx);
  await tx
    .insert(depositProducts)
    .values([
      {
        code: "SAV",
        name: "Regular Savings",
        kind: "SAVINGS",
        ratePa: await getSetting("savings.regular.rate_pa", tx),
        interestBasis: "ADB_ACTUAL_365",
        crediting: "QUARTERLY",
        minBalanceEarn: BigInt(await getSetting("savings.min_balance_earn", tx)),
        maintainingBalance: BigInt(await getSetting("savings.maintaining_balance", tx)),
        dormantAfterMonths: await getSetting("savings.dormant_after_months", tx),
        wtaxRate,
        depositGlKey: "savings_deposits",
        interestGlKey: "interest_expense_deposits",
        wtaxGlKey: "withholding_tax_payable",
      },
      {
        code: "TD",
        name: "Time Deposit",
        kind: "TIME",
        ratePa: DEFAULT_TD_RATE_PA,
        interestBasis: "SIMPLE_ACTUAL_365",
        crediting: "AT_MATURITY",
        wtaxRate,
        depositGlKey: "time_deposits",
        interestGlKey: "interest_expense_deposits",
        wtaxGlKey: "withholding_tax_payable",
      },
    ])
    .onConflictDoNothing({ target: depositProducts.code });
}
