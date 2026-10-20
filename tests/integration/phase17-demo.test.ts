import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import "@/modules/plugins";
import { getDb, withTx } from "@/db/client";
import { setClock } from "@/lib/dates";
import { trialBalance } from "@/modules/ledger/service";
import { batchErrors, postMigration, reconciliation, stageBatch, uploadBatch } from "@/modules/migration/service";
import { MIGRATION_ENTITIES } from "@/modules/migration/templates";
import { dashboardKpis } from "@/modules/reports/kpis";
import { inventoryValuation } from "@/modules/store/reports";
import { waterAccounts, waterRoutes, waterZones } from "@/modules/water/schema";
import { addRoute, addZone } from "@/modules/water/service";
import { DEMO_PUROKS, demoMigration } from "../../scripts/fixtures/demo-migration";
import { CUTOFF, filled, setupMigration } from "../helpers/phase17";

afterEach(() => setClock(null));

describe("Phase 17 demo data (npm run db:seed:demo)", () => {
  it("the sample migration of Pipindan's puroks checks clean, reconciles to the centavo and posts", async () => {
    const { bookkeeper, manager } = await setupMigration();
    await withTx(async (tx) => {
      for (const p of DEMO_PUROKS) {
        await addZone(tx, { code: p.code, name: p.name }, bookkeeper);
        const [zone] = await tx.select().from(waterZones).where(eq(waterZones.code, p.code));
        await addRoute(tx, { zoneId: zone!.id, code: `${p.code}-R1`, name: `${p.name} route 1` }, bookkeeper);
      }
    });
    const data = demoMigration(CUTOFF);
    for (const entity of MIGRATION_ENTITIES) {
      const content = await filled(entity, data[entity]);
      const b = await withTx((tx) => uploadBatch(tx, { entity, fileName: `${entity}.xlsx`, content, cutoffDate: CUTOFF }, bookkeeper));
      expect([entity, await batchErrors(b.id)]).toEqual([entity, []]);
      expect((await withTx((tx) => stageBatch(tx, b.id, bookkeeper))).staged).toBe(true);
    }
    const rec = await reconciliation(CUTOFF);
    expect(rec.blockers).toEqual([]);
    await withTx((tx) => postMigration(tx, { cutoffDate: CUTOFF }, manager));

    expect((await trialBalance(CUTOFF)).balanced).toBe(true);
    expect((await dashboardKpis()).reconciliation.filter((r) => r.difference !== 0n)).toEqual([]);
    expect((await inventoryValuation(CUTOFF)).difference).toBe(0n);
    const byZone = await getDb()
      .select({ zone: waterZones.name, account: waterAccounts.accountNo })
      .from(waterAccounts)
      .innerJoin(waterRoutes, eq(waterRoutes.id, waterAccounts.routeId))
      .innerJoin(waterZones, eq(waterZones.id, waterRoutes.zoneId));
    expect(new Set(byZone.map((r) => r.zone))).toEqual(new Set(DEMO_PUROKS.map((p) => p.name)));
    expect(byZone).toHaveLength(43);
  });
});
