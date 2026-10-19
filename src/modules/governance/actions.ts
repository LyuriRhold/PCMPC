"use server";

import { z } from "zod";
import { withTx } from "@/db/client";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { addOfficer, addTraining, endOfficerTerm, GovernanceError } from "./service";

const EXPECTED = [GovernanceError];
const date = z.string().trim().max(10);
const optionalDate = z
  .string()
  .trim()
  .max(10)
  .nullable()
  .transform((v) => v || null);

const officerSchema = z.object({
  memberNo: z.string().trim().max(20),
  position: z.string().trim().max(100),
  committee: z.string().trim().max(40),
  termStart: date,
  termEnd: optionalDate,
  electedAtGa: optionalDate,
});
/** Manager: records an officer or committee member and their term. */
export async function addOfficerAction(input: z.input<typeof officerSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("members.write");
  try {
    const data = officerSchema.parse(input);
    return ok(await withTx((tx) => addOfficer(tx, data, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const endSchema = z.object({ officerId: z.uuid(), termEnd: date });
/** Manager: ends an officer's term. */
export async function endOfficerTermAction(input: z.input<typeof endSchema>): Promise<ActionResult<null>> {
  const actor = await requirePermission("members.write");
  try {
    const data = endSchema.parse(input);
    await withTx((tx) => endOfficerTerm(tx, data, actor.id));
    return ok(null);
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}

const trainingSchema = z.object({
  title: z.string().trim().max(200),
  provider: z.string().trim().max(200),
  heldOn: date,
  hours: z.string().trim().max(10),
  /** Member nos., separated by commas, spaces or new lines. */
  memberNos: z.string().max(5000),
});
/** Manager: records a training and who attended. */
export async function addTrainingAction(input: z.input<typeof trainingSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission("members.write");
  try {
    const data = trainingSchema.parse(input);
    return ok(await withTx((tx) => addTraining(tx, { ...data, memberNos: data.memberNos.split(/[\s,;]+/).filter(Boolean) }, actor.id)));
  } catch (e) {
    return failFrom(e, EXPECTED);
  }
}
