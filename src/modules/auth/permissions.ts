/**
 * Permission catalog (`<module>.<action>`, PHASE-01 data model) and the default role matrix.
 * The matrix is reference data: it is seeded into `role_permissions` and read from the DB at
 * runtime. In v1 it changes only by editing this seed (the UI grid is read-only).
 * The role assignments follow PLAN.md §3 and are marked CONFIRM in PROGRESS.md › Questions.
 */
export const PERMISSIONS = [
  "members.read",
  "members.write",
  "members.approve",
  "members.read_sensitive",
  "share.read",
  "share.post",
  "savings.read",
  "savings.post",
  "savings.run_interest",
  "loans.read",
  "loans.apply",
  "loans.recommend",
  "loans.approve",
  "loans.release",
  "loans.collect",
  "loans.writeoff",
  "cash.session",
  "cash.receipt",
  "cash.cancel",
  "cash.dv_prepare",
  "cash.dv_approve",
  "cash.verify",
  "water.customers",
  "water.apply",
  "water.approve",
  "water.install",
  "water.rates",
  "water.read_meter",
  "water.review_readings",
  "water.bill",
  "water.adjust_prepare",
  "water.adjust_approve",
  "water.disconnect",
  "water.reconnect",
  "store.pos",
  "store.receive",
  "store.adjust",
  "store.approve_adjust",
  "store.price",
  "gl.read",
  "gl.jv_prepare",
  "gl.jv_approve",
  "gl.close",
  "gl.reopen",
  "gl.coa",
  "reports.read",
  "reports.cda",
  "admin.users",
  "admin.settings",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  { code: "ADMIN", name: "Administrator" },
  { code: "MANAGER", name: "General Manager" },
  { code: "BOOKKEEPER", name: "Bookkeeper / Accountant" },
  { code: "BILLING_CLERK", name: "Water Billing Clerk" },
  { code: "METER_READER", name: "Meter Reader" },
  { code: "TELLER", name: "Cashier / Teller" },
  { code: "LOAN_OFFICER", name: "Loan Officer" },
  { code: "CREDIT_COMMITTEE", name: "Credit Committee" },
  { code: "STORE_CLERK", name: "Store Clerk" },
  { code: "AUDITOR", name: "Auditor" },
  { code: "BOARD", name: "Board of Directors" },
] as const;

export type RoleCode = (typeof ROLES)[number]["code"];

const READ_ALL: Permission[] = [
  "members.read",
  "share.read",
  "savings.read",
  "loans.read",
  "gl.read",
  "reports.read",
];

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: ["admin.users", "admin.settings", "gl.reopen", "audit.read", "reports.read", "water.rates"],
  MANAGER: [
    ...READ_ALL,
    "members.write",
    "members.approve",
    "members.read_sensitive",
    "loans.recommend",
    "loans.approve",
    "loans.release",
    "loans.writeoff",
    "cash.cancel",
    "cash.dv_approve",
    "cash.verify",
    "water.approve",
    "water.rates",
    "water.adjust_approve",
    "store.approve_adjust",
    "store.price",
    "gl.jv_approve",
    "reports.cda",
    "audit.read",
  ],
  BOOKKEEPER: [...READ_ALL, "gl.jv_prepare", "gl.jv_approve", "gl.coa", "gl.close", "cash.dv_prepare", "savings.run_interest", "reports.cda"],
  BILLING_CLERK: [
    "members.read",
    "water.customers",
    "water.apply",
    "water.install",
    "water.review_readings",
    "water.bill",
    "water.adjust_prepare",
    "water.disconnect",
    "water.reconnect",
    "reports.read",
  ],
  METER_READER: ["water.read_meter"],
  TELLER: [
    "members.read",
    "share.read",
    "share.post",
    "savings.read",
    "savings.post",
    "loans.read",
    "loans.collect",
    "cash.session",
    "cash.receipt",
  ],
  LOAN_OFFICER: ["members.read", "members.write", "share.read", "savings.read", "loans.read", "loans.apply", "reports.read"],
  CREDIT_COMMITTEE: ["members.read", "share.read", "savings.read", "loans.read", "loans.approve", "reports.read"],
  STORE_CLERK: ["store.pos", "store.receive", "store.adjust"],
  AUDITOR: [...READ_ALL, "members.read_sensitive", "reports.cda", "audit.read"],
  BOARD: ["reports.read"],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function isRoleCode(value: string): value is RoleCode {
  return ROLES.some((r) => r.code === value);
}
