import type { Db, Tx } from "@/db/client";
import type { BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import type { Permission } from "@/modules/auth/permissions";
import type { LineInput } from "@/modules/ledger/service";

/**
 * The cashiering registry (PLAN §5 rule 9: one counter). Every module that takes or pays out cash
 * registers its receipt items, cash-outs and payor types here; the teller screen and the receipt
 * service only talk to this registry. Built-ins are registered in ./builtins.ts.
 */

export type Payor = { type: string; id: string | null; name: string };

/** Something the payor owes now, shown in the teller's cart (e.g. an unpaid water bill). */
export type Due = { type: string; refId: string | null; description: string; amount: Money; payable: boolean };

export type ItemInput = { type: string; refId: string | null; amount: Money; description: string | null };

export type ReceiptContext = {
  receiptId: string;
  receiptNo: string;
  date: BusinessDate;
  payor: Payor;
  actorId: string;
  sessionId: string;
};

export type ApplyResult = {
  /** Credit lines for this item; they must total the item amount. */
  creditLines: LineInput[];
  /** Description printed on the receipt. */
  description: string;
  /** Sub-ledger reference kept on the receipt item (e.g. the bill id). */
  refId?: string | null;
  /** Anything the item wants kept with the receipt (e.g. how a payment was allocated). */
  breakdown?: unknown;
};

export type StoredItem = { id: string; type: string; refId: string | null; amount: Money; breakdown: unknown };

export type ReceiptItemDef = {
  type: string;
  label: string;
  /** Who may collect this item. */
  permission: Permission;
  /** What the payor owes now (optional: manual items have no dues). */
  dues?: (db: Db | Tx, payor: Payor) => Promise<Due[]>;
  /** Throws on invalid input (wrong amount, unknown reference, …). */
  validate: (tx: Tx, input: ItemInput, ctx: ReceiptContext) => Promise<void>;
  /** Applies sub-ledger effects in the receipt's transaction and returns the credit lines. */
  apply: (tx: Tx, input: ItemInput, ctx: ReceiptContext) => Promise<ApplyResult>;
  /**
   * Undoes the sub-ledger effects when the receipt is cancelled. The ledger side is reversed
   * by the receipt service with an exact mirror entry (reverseJournal).
   */
  reverse: (tx: Tx, item: StoredItem, ctx: ReceiptContext) => Promise<void>;
  /** Optional: runs after the receipt and its item rows exist (e.g. to write rows that reference the item). */
  recorded?: (tx: Tx, item: StoredItem, ctx: ReceiptContext) => Promise<void>;
};

export type CashOutDef = {
  type: string;
  label: string;
  permission: Permission;
};

export type PayorMatch = { id: string; name: string; detail: string };

export type PayorTypeDef = {
  type: string;
  label: string;
  /** Free-typed name (walk-in) instead of a lookup. */
  freeText?: boolean;
  search?: (db: Db | Tx, query: string) => Promise<PayorMatch[]>;
  get?: (db: Db | Tx, id: string) => Promise<PayorMatch | null>;
};

const receiptItems = new Map<string, ReceiptItemDef>();
const cashOuts = new Map<string, CashOutDef>();
const payorTypes = new Map<string, PayorTypeDef>();

export function registerReceiptItem(def: ReceiptItemDef): void {
  receiptItems.set(def.type, def);
}
export function unregisterReceiptItem(type: string): void {
  receiptItems.delete(type);
}
export function receiptItem(type: string): ReceiptItemDef | undefined {
  return receiptItems.get(type);
}
export function receiptItemTypes(): ReceiptItemDef[] {
  return [...receiptItems.values()];
}

export function registerCashOut(def: CashOutDef): void {
  cashOuts.set(def.type, def);
}
export function cashOutType(type: string): CashOutDef | undefined {
  return cashOuts.get(type);
}
export function cashOutTypes(): CashOutDef[] {
  return [...cashOuts.values()];
}

export function registerPayorType(def: PayorTypeDef): void {
  payorTypes.set(def.type, def);
}
export function payorType(type: string): PayorTypeDef | undefined {
  return payorTypes.get(type);
}
export function payorTypeList(): PayorTypeDef[] {
  return [...payorTypes.values()];
}

/** Everything the payor owes now, across all registered item providers. */
export async function duesFor(db: Db | Tx, payor: Payor): Promise<Due[]> {
  const all = await Promise.all(receiptItemTypes().map((d) => (d.dues ? d.dues(db, payor) : Promise.resolve([]))));
  return all.flat();
}
