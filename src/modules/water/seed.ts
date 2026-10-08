import type { Tx } from "@/db/client";
import { getSetting } from "@/modules/settings/service";
import { waterFees, waterRateSchedules, waterRoutes, waterZones } from "./schema";

/** Effective date of the seeded sample tariff versions (CONFIRM: the NWRB-approved tariff). */
export const SAMPLE_TARIFF_EFFECTIVE = "2026-01-01";

/**
 * Water reference data (all CONFIRM, Q-05.1/Q-05.2): one zone and route until PCMPC sends its
 * puroks and reading routes, the DOMAIN §2 sample tariffs as the first rate versions, and the fee
 * schedule. Idempotent.
 */
export async function seedWater(tx: Tx): Promise<void> {
  await tx.insert(waterZones).values({ code: "PIPINDAN", name: "Barangay Pipindan" }).onConflictDoNothing({ target: waterZones.code });
  const [zone] = await tx.select().from(waterZones).limit(1);
  if (zone) {
    await tx.insert(waterRoutes).values({ zoneId: zone.id, code: "R-01", name: "Route 1" }).onConflictDoNothing({ target: waterRoutes.code });
  }

  for (const classification of ["RESIDENTIAL", "COMMERCIAL"] as const) {
    const t = await getSetting(`water.tariff.${classification}`, tx);
    await tx
      .insert(waterRateSchedules)
      .values({
        classification,
        effectiveFrom: SAMPLE_TARIFF_EFFECTIVE,
        minCharge: BigInt(t.minimumCharge),
        minCubic: t.minimumM3,
        blocks: t.blocks.map((b) => ({ from: b.fromM3, to: b.toM3, rate: b.ratePerM3 })),
        nwrbRef: "Sample tariff from DOMAIN §2 (CONFIRM: NWRB-approved tariff)",
      })
      .onConflictDoNothing({ target: [waterRateSchedules.classification, waterRateSchedules.effectiveFrom] });
  }

  const fees = [
    { code: "CONNECTION", name: "Connection / installation fee", amount: await getSetting("water.fee.connection", tx), mappingKey: "water_connection_fee_income" },
    { code: "METER_DEPOSIT", name: "Meter deposit (refundable)", amount: await getSetting("water.fee.meter_deposit", tx), mappingKey: "customers_deposits" },
    { code: "RECONNECTION", name: "Reconnection fee", amount: await getSetting("water.fee.reconnection", tx), mappingKey: "water_reconnection_fee_income" },
  ];
  await tx
    .insert(waterFees)
    .values(fees.map((f) => ({ ...f, amount: BigInt(f.amount) })))
    .onConflictDoNothing({ target: waterFees.code });
}
