import { runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { openSessionAction, issueReceiptAction } from "@/modules/cashiering/actions";
import { makeUser } from "./phase01";
import { seedLedger } from "./phase03";

/** 2026-10-07 09:00 Manila. */
export const DAY = new Date("2026-10-07T01:00:00Z");
/** 2026-10-06 09:00 Manila. */
export const YESTERDAY = new Date("2026-10-06T01:00:00Z");

export async function setupCashiering() {
  await seedLedger();
  setClock(() => DAY);
  const [teller, manager, book] = await Promise.all([
    makeUser("TELLER", "teller1"),
    makeUser("MANAGER", "mgr1"),
    makeUser("BOOKKEEPER", "book1"),
  ]);
  return { teller, manager, book };
}

export async function openSessionAs(userId: string, openingCash = "5,000.00") {
  const r = await runAs(userId, () => openSessionAction({ openingCash }));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** A walk-in OTHER_INCOME receipt; `items` are [incomeItemCode, peso amount]. */
export async function receiptAs(userId: string, items: Array<[string, string]>, birReceiptNo = "BIR-0001") {
  return runAs(userId, () =>
    issueReceiptAction({
      payor: { type: "WALK_IN", id: null, name: "Walk-in Payor" },
      mode: "CASH",
      checkNo: null,
      birReceiptNo,
      items: items.map(([refId, amount]) => ({ type: "OTHER_INCOME", refId, amount, description: null })),
    }),
  );
}
