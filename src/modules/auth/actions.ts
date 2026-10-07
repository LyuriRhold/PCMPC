"use server";

import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { createUser, resetPassword, setUserActive, updateUser, UserRuleError } from "./service";

const userId = z.uuid();
const fullName = z.string().trim().min(1, "Full name is required").max(120);
const email = z.email().max(200).nullable().optional().transform((v) => v ?? null);
const roleCode = z.string().min(1);
const password = z.string().min(1).max(128);

const createSchema = z.object({ username: z.string().trim().min(3).max(30), fullName, email, roleCode, password });
const updateSchema = z.object({ userId, fullName, email, roleCode });
const idSchema = z.object({ userId });
const resetSchema = z.object({ userId, password });

export async function createUserAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("admin.users");
  try {
    const data = createSchema.parse(input);
    const user = await withTx((tx) => createUser(tx, data, actor.id));
    return ok({ id: user.id });
  } catch (e) {
    return failFrom(e, [UserRuleError]);
  }
}

export async function updateUserAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    const data = updateSchema.parse(input);
    await withTx((tx) => updateUser(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [UserRuleError]);
  }
}

export async function deactivateUserAction(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    const data = idSchema.parse(input);
    await withTx((tx) => setUserActive(tx, data.userId, false, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [UserRuleError]);
  }
}

export async function activateUserAction(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    const data = idSchema.parse(input);
    await withTx((tx) => setUserActive(tx, data.userId, true, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [UserRuleError]);
  }
}

export async function resetPasswordAction(input: z.input<typeof resetSchema>): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    const data = resetSchema.parse(input);
    await withTx((tx) => resetPassword(tx, data.userId, data.password, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [UserRuleError]);
  }
}
