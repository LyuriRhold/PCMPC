"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { format, parse as parseMoney } from "@/lib/money";
import { LedgerError } from "@/modules/ledger/service";
import { AccountingError, registerAsset, runDepreciation } from "./assets";
import { FsError } from "./statements";

const EXPECTED = [AccountingError, FsError, LedgerError];

/** No amount here is near this (₱10,000,000,000.00); it keeps typed amounts inside the database's range. */
const MAX_AMOUNT = 1_000_000_000_000n;

function pesos(text: string, what = "amount"): bigint {
  let value: bigint;
  try {
    value = parseMoney(text);
  } catch {
    throw new AccountingError(`Enter the ${what} in pesos, e.g. 36,000.00`);
  }
  if (value > MAX_AMOUNT || value < -MAX_AMOUNT) throw new AccountingError(`The ${what} is too large`);
  return value;
}

const date = z.string().refine(isBusinessDate, "Choose a date");
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month");

// ── Fixed assets (gl.coa: register; gl.close: depreciation) ──

const assetSchema = z.object({
  tag: z.string().trim().max(30),
  description: z.string().trim().max(200),
  classCode: z.string().trim().max(40),
  acquisitionDate: date,
  cost: z.string().trim().max(24),
  salvage: z.string().trim().max(24),
  lifeMonths: z.number().int(),
});
/** Bookkeeper: adds an asset to the register. */
export async function registerAssetAction(input: z.input<typeof assetSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("gl.coa");
  try {
    const data = assetSchema.parse(input);
    return ok(await withTx((tx) => registerAsset(tx, { ...data, cost: pesos(data.cost, "cost"), salvage: pesos(data.salvage || "0", "salvage value") }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const periodSchema = z.object({ period });
/** Bookkeeper: the month's depreciation run (once per month). */
export async function runDepreciationAction(input: z.input<typeof periodSchema>): Promise<ActionResult<{ total: string; assets: number }>> {
  const actor = await requirePermission("gl.close");
  try {
    const data = periodSchema.parse(input);
    const r = await withTx((tx) => runDepreciation(tx, data, actor.id));
    return ok({ total: format(r.total), assets: r.assets });
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
