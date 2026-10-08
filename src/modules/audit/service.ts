import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db/client";
import { addDays, startOfBusinessDay, type BusinessDate } from "@/lib/dates";
import { users } from "@/modules/auth/schema";
import { auditLog } from "./schema";

export type AuditFilters = {
  userId?: string;
  entity?: string;
  action?: string;
  /** Inclusive business dates (Manila). */
  from?: BusinessDate;
  to?: BusinessDate;
  page?: number;
  pageSize?: number;
};

export async function listAuditLog(filters: AuditFilters, db: Db | Tx = getDb()) {
  const where: SQL[] = [];
  if (filters.userId) where.push(eq(auditLog.userId, filters.userId));
  if (filters.entity) where.push(eq(auditLog.entity, filters.entity));
  if (filters.action) where.push(eq(auditLog.action, filters.action));
  if (filters.from) where.push(gte(auditLog.at, startOfBusinessDay(filters.from)));
  if (filters.to) where.push(lt(auditLog.at, startOfBusinessDay(addDays(filters.to, 1))));
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  const cond = where.length ? and(...where) : undefined;

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        userId: auditLog.userId,
        username: users.username,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(cond)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(cond),
  ]);
  return { rows, total: count?.n ?? 0, page, pageSize };
}

/** Distinct values for the viewer's filter dropdowns. */
export async function auditFilterOptions(db: Db | Tx = getDb()) {
  const [actions, entities, people] = await Promise.all([
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db.selectDistinct({ v: auditLog.entity }).from(auditLog).orderBy(auditLog.entity),
    db.select({ id: users.id, username: users.username }).from(users).orderBy(users.username),
  ]);
  return { actions: actions.map((a) => a.v), entities: entities.map((e) => e.v), users: people };
}
