import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { CoaError } from "./coa";
import { accountMappings, accounts, journalEntries, journalLines, type Account, type AccountType, type NormalBalance } from "./schema";

export type NewAccount = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  parentId: string | null;
  isPostable: boolean;
  scaCode: string | null;
};

const view = (a: Account) => ({ code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance, isPostable: a.isPostable, isActive: a.isActive, scaCode: a.scaCode });

async function parentFor(tx: Tx, parentId: string | null, type: AccountType): Promise<Account | null> {
  if (!parentId) return null;
  const [p] = await tx.select().from(accounts).where(eq(accounts.id, parentId));
  if (!p) throw new CoaError("Parent account not found");
  if (p.isPostable) throw new CoaError(`Parent ${p.code} ${p.name} is a postable account; choose a header account`);
  if (p.type !== type) throw new CoaError(`Parent ${p.code} is ${p.type}; the account is ${type}`);
  return p;
}

/** Adds an account under a header of the same type. Codes are unique. */
export async function createAccount(tx: Tx, input: NewAccount, actorId: string): Promise<Account> {
  const [dup] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, input.code));
  if (dup) throw new CoaError(`Account code ${input.code} already exists`);
  const parent = await parentFor(tx, input.parentId, input.type);
  const [a] = await tx
    .insert(accounts)
    .values({ ...input, parentId: parent?.id ?? null, level: (parent?.level ?? 0) + 1, provisional: false, createdBy: actorId })
    .returning();
  if (!a) throw new Error("account insert returned no row");
  await audit(tx, { action: "account.create", entity: "account", entityId: a.id, after: view(a), userId: actorId });
  return a;
}

/**
 * Renames an account or moves it under another header. Code, type, side and postability are fixed
 * once created, because postings depend on them.
 */
export async function updateAccount(tx: Tx, input: { accountId: string; name: string; scaCode: string | null; parentId: string | null }, actorId: string): Promise<Account> {
  const [before] = await tx.select().from(accounts).where(eq(accounts.id, input.accountId)).for("update");
  if (!before) throw new CoaError("Account not found");
  if (input.parentId === before.id) throw new CoaError("An account can't be its own parent");
  const parent = await parentFor(tx, input.parentId, before.type);
  // The new parent must not sit below this account.
  let p: Account | undefined = parent ?? undefined;
  while (p?.parentId) {
    if (p.parentId === before.id) throw new CoaError("That parent is below this account");
    [p] = await tx.select().from(accounts).where(eq(accounts.id, p.parentId));
  }
  const [after] = await tx
    .update(accounts)
    .set({ name: input.name, scaCode: input.scaCode, parentId: parent?.id ?? null, level: (parent?.level ?? 0) + 1 })
    .where(eq(accounts.id, before.id))
    .returning();
  if (!after) throw new Error("account update returned no row");
  await audit(tx, { action: "account.update", entity: "account", entityId: before.id, before: view(before), after: view(after), userId: actorId });
  return after;
}

/** Posted balance of an account over all time (debits minus credits). */
async function lifetimeNet(tx: Db | Tx, accountId: string): Promise<bigint> {
  const [r] = await tx
    .select({ net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
    .where(and(eq(journalLines.accountId, accountId), sql`${journalEntries.status} IN ('POSTED', 'REVERSED')`));
  return BigInt(r?.net ?? "0");
}

/**
 * Activates or deactivates an account. An account with a balance, one that a DOMAIN §6 mapping
 * key points to, or a header with active sub-accounts can't be deactivated.
 */
export async function setAccountActive(tx: Tx, accountId: string, active: boolean, actorId: string): Promise<Account> {
  const [before] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
  if (!before) throw new CoaError("Account not found");
  if (before.isActive === active) return before;
  if (!active) {
    if ((await lifetimeNet(tx, accountId)) !== 0n) throw new CoaError(`${before.code} ${before.name} has a balance and can't be deactivated`);
    const mapped = await tx.select({ key: accountMappings.key }).from(accountMappings).where(eq(accountMappings.accountId, accountId));
    if (mapped.length) throw new CoaError(`${before.code} receives postings for ${mapped.map((m) => m.key).join(", ")}; it can't be deactivated`);
    const [child] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.parentId, accountId), eq(accounts.isActive, true))).limit(1);
    if (child) throw new CoaError(`${before.code} has active sub-accounts; deactivate those first`);
  }
  const [after] = await tx.update(accounts).set({ isActive: active }).where(eq(accounts.id, accountId)).returning();
  if (!after) throw new Error("account update returned no row");
  await audit(tx, { action: active ? "account.activate" : "account.deactivate", entity: "account", entityId: accountId, before: view(before), after: view(after), userId: actorId });
  return after;
}

/** The chart in code order, with mapping keys and the all-time net balance per account. */
export async function listAccounts(db: Db | Tx = getDb()) {
  const [rows, maps, nets] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.code)),
    db.select({ key: accountMappings.key, accountId: accountMappings.accountId, requiresMember: accountMappings.requiresMember }).from(accountMappings),
    db
      .select({ accountId: journalLines.accountId, net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.jeId))
      .where(sql`${journalEntries.status} IN ('POSTED', 'REVERSED')`)
      .groupBy(journalLines.accountId),
  ]);
  const netBy = new Map(nets.map((n) => [n.accountId, BigInt(n.net)]));
  return rows.map((a) => ({
    ...a,
    mappingKeys: maps.filter((m) => m.accountId === a.id).map((m) => m.key),
    requiresMember: maps.some((m) => m.accountId === a.id && m.requiresMember),
    net: netBy.get(a.id) ?? 0n,
  }));
}
