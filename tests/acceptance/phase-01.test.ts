import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertNotSameUser, ForbiddenError, requirePermission, runAs } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { next as nextNumber } from "@/lib/numbering";
import { listAuditLogAction } from "@/modules/audit/actions";
import { auditLog } from "@/modules/audit/schema";
import {
  activateUserAction,
  createUserAction,
  deactivateUserAction,
  resetPasswordAction,
  updateUserAction,
} from "@/modules/auth/actions";
import { signIn } from "@/modules/auth/service";
import { updateSettingAction } from "@/modules/settings/actions";
import { loadUser, makeUser, seedReference, TEST_PASSWORD } from "../helpers/phase01";

// Golden values from docs/phases/PHASE-01-auth-roles-audit.md › Acceptance tests.

const T0 = new Date("2026-10-07T01:00:00Z");

beforeEach(seedReference);
afterEach(() => setClock(null));

describe("Phase 01 acceptance", () => {
  it("A1.1 TELLER calls an action requiring loans.approve → Forbidden; audit row auth.denied", async () => {
    const teller = await makeUser("TELLER", "teller1");

    await expect(runAs(teller.id, () => requirePermission("loans.approve"))).rejects.toBeInstanceOf(ForbiddenError);

    const rows = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.denied"), eq(auditLog.userId, teller.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({ permission: "loans.approve" });
  });

  it('A1.2 ADMIN creates user teller1 → audit user.create, after.username = "teller1", no password/hash', async () => {
    const admin = await makeUser("ADMIN", "admin1");

    const result = await runAs(admin.id, () =>
      createUserAction({ username: "teller1", fullName: "Teller One", roleCode: "TELLER", password: TEST_PASSWORD }),
    );
    expect(result.ok).toBe(true);

    const rows = await getDb().select().from(auditLog).where(eq(auditLog.action, "user.create"));
    const row = rows.find((r) => (r.after as { username?: string } | null)?.username === "teller1");
    expect(row).toBeDefined();
    expect(row?.userId).toBe(admin.id);
    expect((row?.after as { username: string }).username).toBe("teller1");
    expect(JSON.stringify([row?.before, row?.after])).not.toMatch(/password|hash|secret|token/i);
  });

  it("A1.3 5 wrong passwords, then the correct one → locked; after 15 min login succeeds and failed_attempts = 0", async () => {
    setClock(() => T0);
    await makeUser("TELLER", "teller1");

    for (let i = 1; i <= 5; i++) {
      await expect(signIn({ username: "teller1", password: `wrong-password-${i}` })).rejects.toThrow(
        /invalid username or password/i,
      );
    }
    await expect(signIn({ username: "teller1", password: TEST_PASSWORD })).rejects.toThrow(/account locked/i);

    setClock(() => new Date(T0.getTime() + 15 * 60_000));
    await expect(signIn({ username: "teller1", password: TEST_PASSWORD })).resolves.toMatchObject({
      user: { username: "teller1" },
    });
    expect((await loadUser("teller1")).failedAttempts).toBe(0);
  });

  it("A1.4 20 concurrent numbering.next(GJ) in 2026 → GJ-2026-00001 … GJ-2026-00020, no gaps, no duplicates", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => withTx((tx) => nextNumber("GJ", tx, "2026-10-07"))),
    );
    const expected = Array.from({ length: 20 }, (_, i) => `GJ-2026-${String(i + 1).padStart(5, "0")}`);
    expect([...results].sort()).toEqual(expected);
    expect(new Set(results).size).toBe(20);
  });

  it("A1.5 numbering.next(GJ) in a transaction that rolls back, then another call → same number", async () => {
    let rolledBack = "";
    await expect(
      withTx(async (tx) => {
        rolledBack = await nextNumber("GJ", tx, "2026-10-07");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    const second = await withTx((tx) => nextNumber("GJ", tx, "2026-10-07"));
    expect(rolledBack).toBe("GJ-2026-00001");
    expect(second).toBe(rolledBack);
  });

  it("A1.6 deactivated user logs in → rejected", async () => {
    const admin = await makeUser("ADMIN", "admin1");
    const teller = await makeUser("TELLER", "teller1");
    const result = await runAs(admin.id, () => deactivateUserAction({ userId: teller.id }));
    expect(result.ok).toBe(true);

    await expect(signIn({ username: "teller1", password: TEST_PASSWORD })).rejects.toThrow(/inactive/i);
  });

  it("A1.7 AUDITOR opens the audit log → allowed; any mutation action → Forbidden", async () => {
    const auditor = await makeUser("AUDITOR", "auditor1");
    const teller = await makeUser("TELLER", "teller1");

    const page = await runAs(auditor.id, () => listAuditLogAction({}));
    expect(page.ok).toBe(true);

    const mutations: Array<[string, () => Promise<unknown>]> = [
      ["createUser", () => createUserAction({ username: "x_user", fullName: "X", roleCode: "TELLER", password: TEST_PASSWORD })],
      ["updateUser", () => updateUserAction({ userId: teller.id, fullName: "Changed", roleCode: "TELLER", email: null })],
      ["deactivateUser", () => deactivateUserAction({ userId: teller.id })],
      ["activateUser", () => activateUserAction({ userId: teller.id })],
      ["resetPassword", () => resetPasswordAction({ userId: teller.id, password: "Another-Pass-2026" })],
      ["updateSetting", () => updateSettingAction({ key: "water.due_days", value: 20 })],
    ];
    for (const [name, call] of mutations) {
      await expect(runAs(auditor.id, call), name).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('A1.8 assertNotSameUser(u1, u1) → "Segregation of duties: preparer cannot approve"', () => {
    const u1 = "6f1c1f8e-0000-4000-8000-000000000001";
    expect(() => assertNotSameUser(u1, u1)).toThrow("Segregation of duties: preparer cannot approve");
    expect(() => assertNotSameUser(u1, "6f1c1f8e-0000-4000-8000-000000000002")).not.toThrow();
  });

  it("A1.9 direct SQL UPDATE audit_log → DB raises an error (trigger)", async () => {
    await withTx((tx) => audit(tx, { action: "test.event", entity: "test", entityId: "1", before: null, after: { a: 1 } }));

    await expect(getDb().execute(sql`UPDATE audit_log SET action = 'tampered'`)).rejects.toThrow();
    await expect(getDb().execute(sql`DELETE FROM audit_log`)).rejects.toThrow();
    const rows = await getDb().select().from(auditLog).where(eq(auditLog.action, "test.event"));
    expect(rows).toHaveLength(1);
  });
});
