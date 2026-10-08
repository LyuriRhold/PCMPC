import { and, asc, eq, inArray, isNotNull, like, or } from "drizzle-orm";
import { normalizeName } from "@/lib/names";
import { members } from "@/modules/members/schema";
import { accountIdFor } from "@/modules/ledger/service";
import { getSetting } from "@/modules/settings/service";
import { registerCashOut, registerPayorType, registerReceiptItem } from "./registry";

/** Raised for invalid teller input; the message is safe to show. */
export class CashieringError extends Error {
  override name = "CashieringError";
}

/**
 * Phase 04 built-ins: receipt item OTHER_INCOME, cash-outs DV and BANK_DEPOSIT, payor types MEMBER
 * and WALK_IN. Later phases register their own in their modules.
 */
registerReceiptItem({
  type: "OTHER_INCOME",
  label: "Other income",
  permission: "cash.receipt",
  validate: async (tx, input) => {
    const items = await getSetting("cash.other_income_items", tx);
    if (!items.some((i) => i.code === input.refId)) throw new CashieringError(`Unknown income item "${input.refId ?? ""}"`);
  },
  apply: async (tx, input) => {
    const items = await getSetting("cash.other_income_items", tx);
    const item = items.find((i) => i.code === input.refId);
    if (!item) throw new CashieringError(`Unknown income item "${input.refId ?? ""}"`);
    return {
      creditLines: [{ accountId: await accountIdFor(item.mappingKey, tx), credit: input.amount, memo: input.description }],
      description: input.description ? `${item.label}: ${input.description}` : item.label,
      refId: item.code,
    };
  },
  // Other income has no sub-ledger; the receipt's JE reversal is all that's needed.
  reverse: async () => {},
});

registerCashOut({ type: "DV", label: "Disbursement voucher (cash)", permission: "cash.session" });
registerCashOut({ type: "BANK_DEPOSIT", label: "Bank deposit", permission: "cash.session" });

registerPayorType({ type: "WALK_IN", label: "Walk-in", freeText: true });

registerPayorType({
  type: "MEMBER",
  label: "Member",
  search: async (db, query) => {
    const tokens = normalizeName(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const rows = await db
      .select({ id: members.id, memberNo: members.memberNo, lastName: members.lastName, firstName: members.firstName, status: members.status })
      .from(members)
      .where(
        and(
          isNotNull(members.memberNo),
          or(eq(members.status, "ACTIVE"), eq(members.status, "INACTIVE")),
          // Normalized tokens contain only letters, digits and spaces, so they are safe in LIKE.
          ...tokens.map((t) => like(members.searchText, `%${t}%`)),
        ),
      )
      .orderBy(asc(members.lastName), asc(members.firstName))
      .limit(20);
    return rows.map((r) => ({ id: r.id, name: `${r.lastName}, ${r.firstName}`, detail: `${r.memberNo} · ${r.status}` }));
  },
  get: async (db, id) => {
    const [r] = await db.select().from(members).where(inArray(members.id, [id]));
    return r && r.memberNo ? { id: r.id, name: `${r.lastName}, ${r.firstName}`, detail: r.memberNo } : null;
  },
});
