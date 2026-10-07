import { timestamp, uuid } from "drizzle-orm/pg-core";

/** `timestamptz` as a JS Date. Instants only; business dates are `date` columns / BusinessDate strings. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Standard audit columns every table carries (CLAUDE.md conventions). `created_by` is null for system/seed rows. */
export const createdColumns = () => ({
  createdAt: tstz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});
