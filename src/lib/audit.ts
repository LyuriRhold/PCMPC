import type { Db, Tx } from "@/db/client";
import { now } from "@/lib/dates";
import { getActorContext } from "@/lib/request-context";
import { auditLog } from "@/modules/audit/schema";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | number | bigint | null;
  before?: unknown;
  after?: unknown;
  /** Acting user. Omit to use the current actor (runAs context or signed-in session); `null` = system. */
  userId?: string | null;
};

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** Keys that are never written to the audit log, at any depth. */
const SECRET_KEY = /password|passwd|hash|secret|token|salt|credential/i;

/**
 * Converts a value into audit-safe JSON: drops secret-looking keys, turns bigint into its
 * decimal string and Date into ISO text.
 */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || v === undefined) continue;
      out[k] = sanitizeForAudit(v);
    }
    return out;
  }
  return value;
}

/** IP and user agent of the current HTTP request; nulls outside a request. */
export async function requestMeta(): Promise<RequestMeta> {
  const ctx = getActorContext();
  if (ctx) return { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null };
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return { ip: forwarded || h.get("x-real-ip"), userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

async function currentActorId(): Promise<string | null> {
  const { getCurrentUser } = await import("@/lib/auth-guard");
  return (await getCurrentUser())?.id ?? null;
}

/**
 * Appends one row to the audit trail inside `tx`, so the audit row commits or rolls back
 * together with the change it describes. Secrets are stripped from before/after.
 */
export async function audit(tx: Tx | Db, entry: AuditEntry): Promise<void> {
  const userId = entry.userId !== undefined ? entry.userId : await currentActorId();
  const meta = await requestMeta();
  await tx.insert(auditLog).values({
    at: now(),
    userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
    before: sanitizeForAudit(entry.before),
    after: sanitizeForAudit(entry.after),
    ip: meta.ip,
    userAgent: meta.userAgent,
    createdBy: userId,
  });
}
