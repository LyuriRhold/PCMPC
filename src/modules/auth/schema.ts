import { boolean, integer, pgTable, serial, text, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdColumns, tstz } from "@/db/columns";

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  ...createdColumns(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    permissionCode: text("permission_code").notNull(),
    ...createdColumns(),
  },
  (t) => [unique("role_permissions_role_permission_uq").on(t.roleCode, t.permissionCode)],
);

/**
 * Staff users. Better Auth reads this table as its `user` model (JS property names follow
 * Better Auth's field names: `name`, `email`, `emailVerified`, `createdAt`, `updatedAt`, `username`).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  name: text("full_name").notNull(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  roleCode: text("role_code")
    .notNull()
    .references(() => roles.code),
  isActive: boolean("is_active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: tstz("locked_until"),
  lastLoginAt: tstz("last_login_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

// Better Auth's own tables (sessions in Postgres, credential accounts holding the password hash).
// Their shape is defined by the library; `created_by` does not apply to them.

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: tstz("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const authAccounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: tstz("access_token_expires_at"),
  refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tstz("expires_at").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
