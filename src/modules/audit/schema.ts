import { bigint, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdColumns, jsonbValue, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";

/** Append-only audit trail. A trigger (migration 0002) rejects UPDATE and DELETE. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz("at").notNull(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonbValue("before"),
    after: jsonbValue("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    ...createdColumns(),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_user_idx").on(t.userId, t.at),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type AuditRow = typeof auditLog.$inferSelect;
