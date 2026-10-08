"use server";

import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { can, requirePermission } from "@/lib/auth-guard";
import { approveMember, changeStatus, createApplicant, getMemberProfile, MemberRuleError, searchMembers, setBeneficiaries, updateMember } from "./service";
import { approveSchema, beneficiariesSchema, changeStatusSchema, memberInputSchema, searchSchema } from "./validation";

const idSchema = z.object({ memberId: z.uuid() });
const updateSchema = idSchema.extend({ data: memberInputSchema });

export async function createApplicantAction(input: z.input<typeof memberInputSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("members.write");
  try {
    const data = memberInputSchema.parse(input);
    const m = await withTx((tx) => createApplicant(tx, data, actor.id));
    return ok({ id: m.id });
  } catch (e) {
    return failFrom(e, [MemberRuleError]);
  }
}

export async function updateMemberAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const actor = await requirePermission("members.write");
  try {
    const { memberId, data } = updateSchema.parse(input);
    await withTx((tx) => updateMember(tx, memberId, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [MemberRuleError]);
  }
}

export async function approveMemberAction(input: z.input<typeof approveSchema>): Promise<ActionResult<{ memberNo: string }>> {
  const actor = await requirePermission("members.approve");
  try {
    const data = approveSchema.parse(input);
    const m = await withTx((tx) => approveMember(tx, data, actor.id));
    return ok({ memberNo: m.memberNo ?? "" });
  } catch (e) {
    return failFrom(e, [MemberRuleError]);
  }
}

export async function changeMemberStatusAction(input: z.input<typeof changeStatusSchema>): Promise<ActionResult> {
  const actor = await requirePermission("members.approve");
  try {
    const data = changeStatusSchema.parse(input);
    await withTx((tx) => changeStatus(tx, data, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [MemberRuleError]);
  }
}

export async function setBeneficiariesAction(input: z.input<typeof beneficiariesSchema>): Promise<ActionResult> {
  const actor = await requirePermission("members.write");
  try {
    const data = beneficiariesSchema.parse(input);
    await withTx((tx) => setBeneficiaries(tx, data.memberId, data.beneficiaries, actor.id));
    return ok(undefined);
  } catch (e) {
    return failFrom(e, [MemberRuleError]);
  }
}

export async function searchMembersAction(input: z.input<typeof searchSchema>): Promise<ActionResult<Awaited<ReturnType<typeof searchMembers>>>> {
  await requirePermission("members.read");
  try {
    return ok(await searchMembers(searchSchema.parse(input)));
  } catch (e) {
    return failFrom(e, []);
  }
}

/** A member profile. Birthdate, ID no., TIN and mobile are masked unless the user has members.read_sensitive. */
export async function getMemberAction(
  input: z.input<typeof idSchema>,
): Promise<ActionResult<NonNullable<Awaited<ReturnType<typeof getMemberProfile>>>>> {
  const user = await requirePermission("members.read");
  try {
    const { memberId } = idSchema.parse(input);
    const profile = await getMemberProfile(memberId, can(user, "members.read_sensitive"));
    if (!profile) return { ok: false, error: "Member not found" };
    return ok(profile);
  } catch (e) {
    return failFrom(e, []);
  }
}
