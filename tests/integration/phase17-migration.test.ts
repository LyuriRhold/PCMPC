import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { importBatches, stgShareCapital } from "@/modules/migration/schema";
import { makeUser } from "../helpers/phase01";
import { seedLedger } from "../helpers/phase03";

async function bookkeeperOnly() {
  await seedLedger();
  return { bookkeeper: (await makeUser("BOOKKEEPER", "book17")).id };
}

afterEach(() => setClock(null));

/** The rejection's message (Drizzle wraps the database error; the trigger's text is on the cause). */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
    return `${e instanceof Error ? e.message : String(e)} ${cause}`;
  }
  return "no error";
}

describe("T17.1 migration schema", () => {
  it("an import batch can't be deleted, and a rolled-back one is final; staged rows can't be changed", async () => {
    const { bookkeeper } = await bookkeeperOnly();
    const [b] = await getDb()
      .insert(importBatches)
      .values({ entity: "share_capital", fileName: "s.xlsx", fileHash: "h1", content: Buffer.from("x"), cutoffDate: "2026-09-30", uploadedBy: bookkeeper })
      .returning();
    if (!b) throw new Error("no batch");
    const [row] = await getDb().insert(stgShareCapital).values({ batchId: b.id, rowNo: 2, memberNo: "M-1", subscribed: 100n, paidUp: 100n }).returning();
    expect(await failure(getDb().update(stgShareCapital).set({ paidUp: 0n }).where(eq(stgShareCapital.id, row!.id)))).toMatch(/staged rows can't be changed/);
    expect(await failure(getDb().delete(importBatches).where(eq(importBatches.id, b.id)))).toMatch(/can't be deleted/);
    await withTx(async (tx) => {
      await tx.delete(stgShareCapital).where(eq(stgShareCapital.batchId, b.id));
      await tx.update(importBatches).set({ status: "ROLLED_BACK" }).where(eq(importBatches.id, b.id));
    });
    expect(await failure(getDb().update(importBatches).set({ status: "UPLOADED" }).where(eq(importBatches.id, b.id)))).toMatch(/ROLLED_BACK import batch is final/);
  });

  it("the same file can't be open twice, and only one open batch per kind of record", async () => {
    const { bookkeeper } = await bookkeeperOnly();
    const batch = (hash: string, entity: "members" | "savings") => ({ entity, fileName: `${hash}.xlsx`, fileHash: hash, content: Buffer.from(hash), cutoffDate: "2026-09-30", uploadedBy: bookkeeper });
    await getDb().insert(importBatches).values(batch("a", "members"));
    expect(await failure(getDb().insert(importBatches).values(batch("a", "savings")))).toMatch(/import_batches_hash_uq/);
    expect(await failure(getDb().insert(importBatches).values(batch("b", "members")))).toMatch(/import_batches_open_entity_uq/);
  });
});
