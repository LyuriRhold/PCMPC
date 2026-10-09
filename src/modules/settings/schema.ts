import { bigint, pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { createdColumns, jsonbValue, tstz } from "@/db/columns";
import { users } from "@/modules/auth/schema";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonbValue("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
  ...createdColumns(),
});

export const settingsHistory = pgTable("settings_history", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  key: text("key").notNull(),
  oldValue: jsonbValue("old_value"),
  newValue: jsonbValue("new_value").notNull(),
  changedBy: uuid("changed_by").references(() => users.id),
  changedAt: tstz("changed_at").notNull(),
  ...createdColumns(),
});
