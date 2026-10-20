import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { and, desc, eq, getTableName, inArray, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { audit } from "@/lib/audit";
import { formatDate, now, type BusinessDate } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { MigrationError } from "./errors";
import { readSheet, type RowError } from "./parse";
import {
  importBatches,
  importErrors,
  STAGING,
  stgLoans,
  stgMembers,
  stgSavings,
  stgShareCapital,
  stgStoreAr,
  stgStoreStock,
  stgSuppliers,
  stgTimeDeposits,
  stgTrialBalance,
  stgWaterAccounts,
  stgWaterBills,
  type BatchStatus,
  type ImportBatch,
  type MigrationEntity,
} from "./schema";
import { TEMPLATES, workbookBytes } from "./templates";
import { cutoffProblem, validateRows, type Validated } from "./validate";

export { MigrationError } from "./errors";

/**
 * Import batches (PHASE-17 T17.3, T17.6): upload = store the file and dry-run it (problems listed
 * by row and column, nothing written to live tables); stage = re-check and copy the rows into the
 * batch's stg_* table; roll back = remove an unposted batch's staged rows. Every step is audited.
 */

export const OPEN_STATUSES: BatchStatus[] = ["UPLOADED", "VALIDATED", "STAGED"];
/** Largest file accepted (a few thousand rows fit easily). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const STATUS_LABEL: Record<BatchStatus, string> = {
  UPLOADED: "Uploaded (has errors)",
  VALIDATED: "Checked",
  STAGED: "Staged",
  POSTED: "Posted",
  ROLLED_BACK: "Rolled back",
};

/** Files that refer to the records of another file: they are rolled back first. */
const DEPENDENTS: Partial<Record<MigrationEntity, MigrationEntity[]>> = {
  members: ["share_capital", "savings", "time_deposits", "loans", "water_accounts", "store_ar"],
  savings: ["time_deposits"],
  water_accounts: ["water_bills"],
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** New files can be imported for the cut-off: nothing posted yet, and no open files for another cut-off. */
async function assertCanImport(tx: Tx, cutoff: BusinessDate): Promise<void> {
  const problem = cutoffProblem(cutoff);
  if (problem) throw new MigrationError(problem);
  const [posted] = await tx.select({ cutoff: importBatches.cutoffDate }).from(importBatches).where(eq(importBatches.status, "POSTED")).limit(1);
  if (posted) throw new MigrationError(`The opening balances were posted (cut-off ${formatDate(posted.cutoff)}); later changes go through the regular screens`);
  const [other] = await tx
    .select({ cutoff: importBatches.cutoffDate })
    .from(importBatches)
    .where(and(inArray(importBatches.status, OPEN_STATUSES), ne(importBatches.cutoffDate, cutoff)))
    .limit(1);
  if (other) throw new MigrationError(`Files for the cut-off ${formatDate(other.cutoff)} are open; use that cut-off or roll them back first`);
}

async function lockBatch(tx: Tx, batchId: string): Promise<ImportBatch> {
  const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
  if (!b) throw new MigrationError("Import batch not found");
  return b;
}

/** Reads and checks a batch's file, replacing its error list. */
async function dryRun(tx: Tx, batch: ImportBatch): Promise<{ result: Validated | null; rowCount: number; errors: RowError[] }> {
  const sheet = await readSheet(batch.entity, batch.content);
  const checked = sheet.errors.length ? { result: null, errors: sheet.errors } : await validateRows(tx, batch.entity, sheet.rows, batch.cutoffDate);
  await tx.delete(importErrors).where(eq(importErrors.batchId, batch.id));
  for (let i = 0; i < checked.errors.length; i += 1000) {
    await tx.insert(importErrors).values(checked.errors.slice(i, i + 1000).map((e) => ({ ...e, batchId: batch.id, createdBy: batch.uploadedBy })));
  }
  return { result: checked.result, rowCount: sheet.rows.length, errors: checked.errors };
}

export type UploadInput = { entity: MigrationEntity; fileName: string; content: Uint8Array; cutoffDate: BusinessDate };

/**
 * Uploads a filled template and dry-runs it. The same file can't be uploaded twice (SHA-256);
 * an earlier file of the same kind that wasn't staged is replaced (rolled back).
 */
export async function uploadBatch(tx: Tx, input: UploadInput, actorId: string) {
  await assertCanImport(tx, input.cutoffDate);
  const def = TEMPLATES[input.entity];
  if (input.content.byteLength === 0) throw new MigrationError("The file is empty");
  if (input.content.byteLength > MAX_FILE_BYTES) throw new MigrationError("The file is larger than 4 MB; split it into several files");
  const fileHash = sha256(input.content);
  const [dup] = await tx
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.fileHash, fileHash), ne(importBatches.status, "ROLLED_BACK")))
    .limit(1);
  if (dup) throw new MigrationError(`This file was already uploaded (${TEMPLATES[dup.entity].title}: ${dup.fileName}, ${STATUS_LABEL[dup.status].toLowerCase()})`);
  const [open] = await tx
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.entity, input.entity), inArray(importBatches.status, OPEN_STATUSES)))
    .for("update");
  if (open?.status === "STAGED") throw new MigrationError(`The ${def.title} file ${open.fileName} is staged; roll it back before uploading another one`);
  if (open) await markRolledBack(tx, open, actorId, "replaced by a new upload");

  const [batch] = await tx
    .insert(importBatches)
    .values({ entity: input.entity, fileName: input.fileName.trim() || `${input.entity}.xlsx`, fileHash, content: Buffer.from(input.content), cutoffDate: input.cutoffDate, uploadedBy: actorId, createdBy: actorId })
    .returning();
  if (!batch) throw new Error("import batch insert returned no row");
  const { rowCount, errors } = await dryRun(tx, batch);
  const status: BatchStatus = errors.length ? "UPLOADED" : "VALIDATED";
  await tx.update(importBatches).set({ status, rowCount, errorCount: errors.length }).where(eq(importBatches.id, batch.id));
  await audit(tx, {
    action: "migration.upload",
    entity: "import_batch",
    entityId: batch.id,
    after: { entity: input.entity, fileName: batch.fileName, cutoff: input.cutoffDate, rows: rowCount, errors: errors.length, sha256: fileHash },
    userId: actorId,
  });
  return { id: batch.id, status, rowCount, errorCount: errors.length };
}

async function insertStaged(tx: Tx, batchId: string, v: Validated): Promise<void> {
  const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / 500) }, (_x, i) => rows.slice(i * 500, i * 500 + 500));
  switch (v.entity) {
    case "members":
      for (const c of chunks(v.rows)) await tx.insert(stgMembers).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "share_capital":
      for (const c of chunks(v.rows)) await tx.insert(stgShareCapital).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "savings":
      for (const c of chunks(v.rows)) await tx.insert(stgSavings).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "time_deposits":
      for (const c of chunks(v.rows)) await tx.insert(stgTimeDeposits).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "loans":
      for (const c of chunks(v.rows)) await tx.insert(stgLoans).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "water_accounts":
      for (const c of chunks(v.rows)) await tx.insert(stgWaterAccounts).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "water_bills":
      for (const c of chunks(v.rows)) await tx.insert(stgWaterBills).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "store_stock":
      for (const c of chunks(v.rows)) await tx.insert(stgStoreStock).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "suppliers":
      for (const c of chunks(v.rows)) await tx.insert(stgSuppliers).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "store_ar":
      for (const c of chunks(v.rows)) await tx.insert(stgStoreAr).values(c.map((r) => ({ ...r, batchId })));
      return;
    case "trial_balance":
      for (const c of chunks(v.rows)) await tx.insert(stgTrialBalance).values(c.map((r) => ({ ...r, batchId })));
      return;
  }
}

/**
 * Stages a checked file: it is checked again (other files may have been staged or rolled back
 * since) and its rows are copied into its staging table. If problems turned up, the batch goes
 * back to UPLOADED with the new error list and nothing is staged.
 */
export async function stageBatch(tx: Tx, batchId: string, actorId: string): Promise<{ staged: boolean; rowCount: number; errorCount: number }> {
  const batch = await lockBatch(tx, batchId);
  if (batch.status !== "VALIDATED") {
    throw new MigrationError(
      batch.status === "UPLOADED"
        ? `Fix the ${batch.errorCount} problem(s) in the file and upload it again`
        : batch.status === "STAGED"
          ? "This file is already staged"
          : `This file is ${STATUS_LABEL[batch.status].toLowerCase()}`,
    );
  }
  await assertCanImport(tx, batch.cutoffDate);
  const { result, rowCount, errors } = await dryRun(tx, batch);
  if (errors.length || !result) {
    await tx.update(importBatches).set({ status: "UPLOADED", rowCount, errorCount: errors.length }).where(eq(importBatches.id, batch.id));
    await audit(tx, { action: "migration.stage_failed", entity: "import_batch", entityId: batch.id, after: { errors: errors.length }, userId: actorId });
    return { staged: false, rowCount, errorCount: errors.length };
  }
  await insertStaged(tx, batch.id, result);
  await tx.update(importBatches).set({ status: "STAGED", stagedAt: now(), rowCount, errorCount: 0 }).where(eq(importBatches.id, batch.id));
  await audit(tx, { action: "migration.stage", entity: "import_batch", entityId: batch.id, after: { entity: batch.entity, rows: rowCount }, userId: actorId });
  return { staged: true, rowCount, errorCount: 0 };
}

async function markRolledBack(tx: Tx, batch: ImportBatch, actorId: string, reason: string): Promise<void> {
  await tx.execute(sql`DELETE FROM ${sql.identifier(getTableName(STAGING[batch.entity]))} WHERE batch_id = ${batch.id}`);
  await tx.update(importBatches).set({ status: "ROLLED_BACK", rolledBackAt: now(), rolledBackBy: actorId }).where(eq(importBatches.id, batch.id));
  await audit(tx, {
    action: "migration.rollback",
    entity: "import_batch",
    entityId: batch.id,
    before: { status: batch.status, rows: batch.rowCount },
    after: { entity: batch.entity, fileName: batch.fileName, reason },
    userId: actorId,
  });
}

/** Rolls back an unposted batch completely: its staged rows are removed; the file and its error list are kept. */
export async function rollbackBatch(tx: Tx, batchId: string, actorId: string): Promise<void> {
  const batch = await lockBatch(tx, batchId);
  if (batch.status === "POSTED") throw new MigrationError("A posted file can't be rolled back; correct the records through the regular screens");
  if (batch.status === "ROLLED_BACK") throw new MigrationError("This file is already rolled back");
  const dependents = DEPENDENTS[batch.entity] ?? [];
  if (dependents.length) {
    const open = await tx
      .select({ entity: importBatches.entity })
      .from(importBatches)
      .where(and(inArray(importBatches.entity, dependents), inArray(importBatches.status, OPEN_STATUSES), eq(importBatches.cutoffDate, batch.cutoffDate)));
    if (open.length) {
      throw new MigrationError(`Roll back the ${open.map((o) => TEMPLATES[o.entity].title).join(", ")} file(s) first: they refer to the ${TEMPLATES[batch.entity].title.toLowerCase()}`);
    }
  }
  await markRolledBack(tx, batch, actorId, "rolled back");
}

export async function getBatch(batchId: string, db: Db | Tx = getDb()): Promise<ImportBatch | null> {
  const [b] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  return b ?? null;
}

/** Batches, newest first, without the file contents. */
export async function listBatches(db: Db | Tx = getDb()) {
  return db
    .select({
      id: importBatches.id,
      entity: importBatches.entity,
      fileName: importBatches.fileName,
      cutoffDate: importBatches.cutoffDate,
      status: importBatches.status,
      rowCount: importBatches.rowCount,
      errorCount: importBatches.errorCount,
      createdAt: importBatches.createdAt,
      uploadedBy: users.username,
    })
    .from(importBatches)
    .innerJoin(users, eq(users.id, importBatches.uploadedBy))
    .orderBy(desc(importBatches.createdAt));
}

/** The dry-run report of a batch: by row, then in the template's column order. */
export async function batchErrors(batchId: string, db: Db | Tx = getDb()): Promise<RowError[]> {
  const [b] = await db.select({ entity: importBatches.entity }).from(importBatches).where(eq(importBatches.id, batchId));
  if (!b) return [];
  const order = TEMPLATES[b.entity].columns.map((c) => c.header);
  const at = (column: string) => (order.includes(column) ? order.indexOf(column) : order.length);
  const rows = await db.select({ row: importErrors.row, column: importErrors.column, message: importErrors.message }).from(importErrors).where(eq(importErrors.batchId, batchId));
  return rows.sort((a, z) => a.row - z.row || at(a.column) - at(z.column));
}

/** The error list as a workbook (Row | Column | Message), to fix the file against. */
export async function errorWorkbook(batchId: string, db: Db | Tx = getDb()): Promise<ArrayBuffer> {
  const batch = await getBatch(batchId, db);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Errors", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Row", width: 8 },
    { header: "Column", width: 28 },
    { header: "Message", width: 100 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const e of await batchErrors(batchId, db)) ws.addRow([e.row, e.column, e.message]);
  if (batch) wb.title = `${TEMPLATES[batch.entity].title} · ${batch.fileName}`;
  return workbookBytes(wb);
}

/** How many rows of a batch are in its staging table. */
export async function stagedRowCount(batchId: string, db: Db | Tx = getDb()): Promise<number> {
  const batch = await getBatch(batchId, db);
  if (!batch) return 0;
  const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(getTableName(STAGING[batch.entity]))} WHERE batch_id = ${batchId}`);
  return r.rows[0]?.n ?? 0;
}
