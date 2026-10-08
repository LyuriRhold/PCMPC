import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { normalizeName } from "@/lib/names";
import { format } from "@/lib/money";
import { CashieringError } from "@/modules/cashiering/builtins";
import { registerPayorType, registerReceiptItem, type ItemInput, type ReceiptContext } from "@/modules/cashiering/registry";
import { accountIdFor } from "@/modules/ledger/service";
import { waterAccounts, waterApplications, waterCustomers } from "./schema";
import { customerName, feeByCode, feePaid } from "./service";

/**
 * Water's plug-ins for the teller counter (Phase 04 registry): payor type WATER_CUSTOMER and
 * receipt items WATER_CONNECTION_FEE, METER_DEPOSIT and WATER_OTHER_FEE.
 */

registerPayorType({
  type: "WATER_CUSTOMER",
  label: "Water customer",
  search: async (db, query) => {
    const tokens = normalizeName(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const byAccount = await db
      .select({ customerId: waterAccounts.customerId })
      .from(waterAccounts)
      .where(like(waterAccounts.accountNo, `%${query.trim().toUpperCase().replaceAll("%", "").replaceAll("_", "")}%`))
      .limit(20);
    const rows = await db
      .select()
      .from(waterCustomers)
      .where(
        or(
          and(...tokens.map((t) => like(waterCustomers.searchText, `%${t}%`))),
          byAccount.length ? inArray(waterCustomers.id, byAccount.map((r) => r.customerId)) : undefined,
        ),
      )
      .orderBy(asc(waterCustomers.customerNo))
      .limit(20);
    return rows.map((c) => ({ id: c.id, name: customerName(c), detail: `${c.customerNo} · ${c.type === "MEMBER" ? "member" : "non-member"}` }));
  },
  get: async (db, id) => {
    const [c] = await db.select().from(waterCustomers).where(eq(waterCustomers.id, id));
    return c ? { id: c.id, name: customerName(c), detail: c.customerNo } : null;
  },
});

/** The approved application a fee item is for, checked against the receipt's payor. */
async function applicationFor(tx: Tx, input: ItemInput, ctx: ReceiptContext) {
  if (!input.refId) throw new CashieringError("Choose the water application");
  const [app] = await tx.select().from(waterApplications).where(eq(waterApplications.id, input.refId));
  if (!app) throw new CashieringError("Water application not found");
  if (ctx.payor.type !== "WATER_CUSTOMER" || ctx.payor.id !== app.customerId) throw new CashieringError(`Collect ${app.appNo}'s fees from its water customer`);
  if (app.status !== "APPROVED") throw new CashieringError(`${app.appNo} is ${app.status}; fees are collected after approval and before installation`);
  return app;
}

async function assertFee(tx: Tx, itemType: string, feeCode: string, input: ItemInput, ctx: ReceiptContext) {
  const app = await applicationFor(tx, input, ctx);
  const fee = await feeByCode(feeCode, tx);
  if (!fee) throw new CashieringError(`The ${feeCode} fee isn't set up`);
  if (input.amount !== fee.amount) throw new CashieringError(`${fee.name} is ${format(fee.amount)}`);
  if (await feePaid(itemType, app.id, tx)) throw new CashieringError(`${fee.name} for ${app.appNo} is already paid`);
  return { app, fee };
}

async function blockAfterInstall(tx: Tx, applicationId: string | null) {
  if (!applicationId) return;
  const [app] = await tx.select().from(waterApplications).where(eq(waterApplications.id, applicationId));
  if (app?.status === "INSTALLED") throw new CashieringError(`${app.appNo} already has a meter installed; this receipt can't be cancelled`);
}

registerReceiptItem({
  type: "WATER_CONNECTION_FEE",
  label: "Water connection fee",
  permission: "cash.receipt",
  dues: async (db, payor) => {
    if (payor.type !== "WATER_CUSTOMER" || !payor.id) return [];
    const fee = await feeByCode("CONNECTION", db);
    if (!fee) return [];
    const apps = await db.select().from(waterApplications).where(and(eq(waterApplications.customerId, payor.id), eq(waterApplications.status, "APPROVED")));
    const out = [];
    for (const a of apps) {
      if (!(await feePaid("WATER_CONNECTION_FEE", a.id, db))) out.push({ type: "WATER_CONNECTION_FEE", refId: a.id, description: `Connection fee · ${a.appNo}`, amount: fee.amount, payable: true });
    }
    return out;
  },
  validate: async (tx, input, ctx) => {
    await assertFee(tx, "WATER_CONNECTION_FEE", "CONNECTION", input, ctx);
  },
  apply: async (tx, input, ctx) => {
    const { app, fee } = await assertFee(tx, "WATER_CONNECTION_FEE", "CONNECTION", input, ctx);
    return { creditLines: [{ accountId: await accountIdFor(fee.mappingKey, tx), credit: input.amount }], description: `Connection fee · ${app.appNo}`, refId: app.id };
  },
  reverse: async (tx, item) => blockAfterInstall(tx, item.refId),
});

registerReceiptItem({
  type: "METER_DEPOSIT",
  label: "Water meter deposit",
  permission: "cash.receipt",
  dues: async (db, payor) => {
    if (payor.type !== "WATER_CUSTOMER" || !payor.id) return [];
    const fee = await feeByCode("METER_DEPOSIT", db);
    if (!fee) return [];
    const apps = await db.select().from(waterApplications).where(and(eq(waterApplications.customerId, payor.id), eq(waterApplications.status, "APPROVED")));
    const out = [];
    for (const a of apps) {
      if (!(await feePaid("METER_DEPOSIT", a.id, db))) out.push({ type: "METER_DEPOSIT", refId: a.id, description: `Meter deposit · ${a.appNo}`, amount: fee.amount, payable: true });
    }
    return out;
  },
  validate: async (tx, input, ctx) => {
    await assertFee(tx, "METER_DEPOSIT", "METER_DEPOSIT", input, ctx);
  },
  apply: async (tx, input, ctx) => {
    const { app, fee } = await assertFee(tx, "METER_DEPOSIT", "METER_DEPOSIT", input, ctx);
    if (!app.accountId) throw new CashieringError(`${app.appNo} has no service account yet`);
    // Customers' Deposits is a customer sub-ledger; the account also keeps the deposit held.
    const [account] = await tx.select().from(waterAccounts).where(eq(waterAccounts.id, app.accountId)).for("update");
    if (!account) throw new CashieringError("Service account not found");
    await tx.update(waterAccounts).set({ depositAmount: account.depositAmount + input.amount }).where(eq(waterAccounts.id, account.id));
    return {
      creditLines: [{ accountId: await accountIdFor(fee.mappingKey, tx), credit: input.amount, customerId: app.customerId }],
      description: `Meter deposit · ${account.accountNo}`,
      refId: app.id,
      breakdown: { accountId: account.id },
    };
  },
  reverse: async (tx, item) => {
    await blockAfterInstall(tx, item.refId);
    const accountId = (item.breakdown as { accountId?: string } | null)?.accountId;
    if (!accountId) return;
    const [account] = await tx.select().from(waterAccounts).where(eq(waterAccounts.id, accountId)).for("update");
    if (account) await tx.update(waterAccounts).set({ depositAmount: account.depositAmount - item.amount }).where(eq(waterAccounts.id, accountId));
  },
});

registerReceiptItem({
  type: "WATER_OTHER_FEE",
  label: "Other water fee",
  permission: "cash.receipt",
  validate: async (tx, input) => {
    if (!input.refId || input.refId === "CONNECTION" || input.refId === "METER_DEPOSIT") throw new CashieringError("Choose a water fee");
    const fee = await feeByCode(input.refId, tx);
    if (!fee) throw new CashieringError(`Unknown water fee ${input.refId}`);
  },
  apply: async (tx, input) => {
    const fee = await feeByCode(input.refId ?? "", tx);
    if (!fee) throw new CashieringError(`Unknown water fee ${input.refId ?? ""}`);
    return {
      creditLines: [{ accountId: await accountIdFor(fee.mappingKey, tx), credit: input.amount }],
      description: input.description ? `${fee.name}: ${input.description}` : fee.name,
      refId: fee.code,
    };
  },
  reverse: async () => {},
});
