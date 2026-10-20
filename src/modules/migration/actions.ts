"use server";

import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { MigrationError } from "./errors";
import { MIGRATION_ENTITIES, type BatchStatus } from "./schema";
import { rollbackBatch, stageBatch, uploadBatch } from "./service";

const EXPECTED = [MigrationError];

const uploadSchema = z.object({
  entity: z.enum(MIGRATION_ENTITIES, "Choose what the file holds"),
  cutoffDate: z.string().trim().max(10),
});

/** Bookkeeper: uploads a filled template (multipart: entity, cutoffDate, file) and dry-runs it. */
export async function uploadBatchAction(form: FormData): Promise<ActionResult<{ id: string; status: BatchStatus; rowCount: number; errorCount: number }>> {
  const actor = await requirePermission("migration.import");
  try {
    const data = uploadSchema.parse({ entity: form.get("entity"), cutoffDate: form.get("cutoffDate") });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the Excel file to upload" };
    const content = new Uint8Array(await file.arrayBuffer());
    return ok(await withTx((tx) => uploadBatch(tx, { ...data, fileName: file.name, content }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const batchSchema = z.object({ batchId: z.uuid() });

/** Bookkeeper: re-checks a checked file and copies its rows into staging. */
export async function stageBatchAction(input: z.input<typeof batchSchema>): Promise<ActionResult<{ staged: boolean; rowCount: number; errorCount: number }>> {
  const actor = await requirePermission("migration.import");
  try {
    const { batchId } = batchSchema.parse(input);
    return ok(await withTx((tx) => stageBatch(tx, batchId, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

/** Bookkeeper: rolls back an unposted file (its staged rows are removed). */
export async function rollbackBatchAction(input: z.input<typeof batchSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("migration.import");
  try {
    const { batchId } = batchSchema.parse(input);
    await withTx((tx) => rollbackBatch(tx, batchId, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
