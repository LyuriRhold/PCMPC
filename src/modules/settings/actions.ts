"use server";

import "@/modules/plugins";
import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { SettingError, updateSetting } from "./service";

const schema = z.object({ key: z.string().min(1).max(100), value: z.unknown() });

/** Changes one coop setting. The value is validated against the setting's own schema in the service. */
export async function updateSettingAction(input: z.input<typeof schema>): Promise<ActionResult> {
  const actor = await requirePermission("admin.settings");
  try {
    const data = schema.parse(input);
    await withTx((tx) => updateSetting(tx, data.key, data.value, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [SettingError]);
  }
}
