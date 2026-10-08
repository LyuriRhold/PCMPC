import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** `timestamptz` as a JS Date. Instants only; business dates are `date` columns / BusinessDate strings. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Standard audit columns every table carries (CLAUDE.md conventions). `created_by` is null for system/seed rows. */
export const createdColumns = () => ({
  createdAt: tstz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

/**
 * jsonb without Drizzle's second JSON.parse: node-postgres already parses jsonb, so Drizzle's
 * own jsonb column turns a stored JSON string like "350000" into the number 350000. Use this for
 * any column whose top-level value can be a string (settings values, audit before/after).
 */
export const jsonbValue = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value,
});
