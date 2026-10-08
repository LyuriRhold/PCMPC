import { withTx } from "@/db/client";
import { ensureFiscalYear } from "@/modules/ledger/periods";
import { accountIdFor } from "@/modules/ledger/service";
import { seedReference } from "./phase01";

/** Reference data plus fiscal year 2026 (the golden values are dated in 2026). */
export async function seedLedger(): Promise<void> {
  await seedReference();
  await withTx((tx) => ensureFiscalYear(tx, 2026));
}

/** Account id for a DOMAIN §6 mapping key (e.g. "cash_on_hand"). */
export function acct(key: string): Promise<string> {
  return accountIdFor(key);
}

/** Peso amounts in tests, as centavos: P(1000) = ₱1,000.00. */
export function P(pesos: number, centavos = 0): bigint {
  return BigInt(pesos) * 100n + BigInt(centavos);
}
