import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { runAs } from "@/lib/auth-guard";
import { updateSettingAction } from "@/modules/settings/actions";
import { incomeAccountOptions } from "@/modules/settings/service";
import { waterFees } from "@/modules/water/schema";
import { makeUser } from "../helpers/phase01";
import { seedLedger } from "../helpers/phase03";

let admin = "";
beforeEach(async () => {
  await seedLedger();
  admin = (await makeUser("ADMIN", "admin1")).id;
});

describe("coop settings for non-technical users", () => {
  it("a water fee changed in settings is what the teller collects next", async () => {
    expect(await runAs(admin, () => updateSettingAction({ key: "water.fee.reconnection", value: "35000" }))).toEqual({ ok: true, data: undefined });
    const [fee] = await getDb().select().from(waterFees).where(eq(waterFees.code, "RECONNECTION"));
    expect(fee?.amount).toBe(35000n);
  });

  it("refused values come back in plain words, with the setting's name", async () => {
    expect(await runAs(admin, () => updateSettingAction({ key: "surplus.reserve_pct", value: "0.05" }))).toEqual({ ok: false, error: "Reserve fund: must be between 10% and 100%" });
    expect(await runAs(admin, () => updateSettingAction({ key: "water.due_days", value: 0 }))).toEqual({ ok: false, error: "Bills are due: must be at least 1" });
  });

  it("other-income items pick from income accounts by name", async () => {
    const options = await incomeAccountOptions();
    expect(Object.values(options)).toEqual(expect.arrayContaining([expect.stringMatching(/Certification Fee Income/i)]));
    expect(Object.keys(options)).toContain("certification_fee_income");
  });
});
