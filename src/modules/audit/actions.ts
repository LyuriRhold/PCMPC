"use server";

import { z } from "zod";
import { failFrom, ok, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth-guard";
import { isBusinessDate } from "@/lib/dates";
import { listAuditLog } from "./service";

const businessDate = z.string().refine(isBusinessDate, "expected YYYY-MM-DD");
const filters = z.object({
  userId: z.uuid().optional(),
  entity: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});

/** Reads the audit log (read-only; needs audit.read). */
export async function listAuditLogAction(
  input: z.input<typeof filters>,
): Promise<ActionResult<Awaited<ReturnType<typeof listAuditLog>>>> {
  await requirePermission("audit.read");
  try {
    return ok(await listAuditLog(filters.parse(input)));
  } catch (e) {
    return failFrom(e, []);
  }
}
