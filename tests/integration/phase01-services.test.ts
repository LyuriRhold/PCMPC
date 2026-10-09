import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, withTx } from "@/db/client";
import { runSeedSteps } from "@/db/seed";
import { getAuth } from "@/lib/auth";
import { getCurrentUser, requirePermission, runAs, UnauthenticatedError } from "@/lib/auth-guard";
import { setClock } from "@/lib/dates";
import { next as nextNumber, NumberingError } from "@/lib/numbering";
import { auditLog } from "@/modules/audit/schema";
import { listAuditLog } from "@/modules/audit/service";
import { createUserAction, deactivateUserAction, resetPasswordAction, updateUserAction } from "@/modules/auth/actions";
import { rolePermissions, roles, sessions } from "@/modules/auth/schema";
import { setUserActive, signIn, updateUser } from "@/modules/auth/service";
import { numberSeries } from "@/modules/numbering/schema";
import { settings } from "@/modules/settings/schema";
import { getSetting, settingHistory } from "@/modules/settings/service";
import { updateSettingAction } from "@/modules/settings/actions";
import { SETTING_KEYS } from "@/modules/settings/registry";
import { loadUser, makeUser, seedReference, TEST_PASSWORD } from "../helpers/phase01";

const T0 = new Date("2026-10-07T01:00:00Z");
const db = () => getDb();
const OK = { ok: true, data: undefined };

beforeEach(seedReference);
afterEach(() => setClock(null));

async function failLogins(username: string, times: number) {
  for (let i = 0; i < times; i++) {
    await expect(signIn({ username, password: "wrong-password!" })).rejects.toThrow();
  }
}

describe("T1.3 seed", () => {
  it("is idempotent and complete", async () => {
    await seedReference();
    const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(roles);
    const [s] = await db().select({ n: sql<number>`count(*)::int` }).from(settings);
    expect(r?.n).toBe(11);
    expect(s?.n).toBe(SETTING_KEYS.length);
    const adminPerms = await db().select().from(rolePermissions).where(eq(rolePermissions.roleCode, "ADMIN"));
    expect(adminPerms.map((p) => p.permissionCode)).toContain("admin.users");
  });

  it("refuses to seed an admin without SEED_ADMIN_* env", async () => {
    const saved = process.env.SEED_ADMIN_PASSWORD;
    delete process.env.SEED_ADMIN_PASSWORD;
    try {
      await expect(withTx((tx) => runSeedSteps(tx, { includeAdmin: true }))).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    } finally {
      if (saved !== undefined) process.env.SEED_ADMIN_PASSWORD = saved;
    }
  });
});

describe("T1.1/T1.6 sign-in and lockout", () => {
  it("issues a Postgres session for the user (username is case-insensitive)", async () => {
    const u = await makeUser("TELLER", "teller1");
    const res = await signIn({ username: "TELLER1", password: TEST_PASSWORD });
    const [row] = await db().select().from(sessions).where(eq(sessions.userId, u.id));
    expect(row?.token).toBe(res.token);
    expect((await loadUser("teller1")).lastLoginAt).not.toBeNull();
  });

  it("an expired lock starts the count again (one more wrong password does not re-lock)", async () => {
    setClock(() => T0);
    await makeUser("TELLER", "teller1");
    await failLogins("teller1", 5);
    expect((await loadUser("teller1")).lockedUntil).not.toBeNull();

    setClock(() => new Date(T0.getTime() + 16 * 60_000));
    await expect(signIn({ username: "teller1", password: "wrong-password!" })).rejects.toThrow(/invalid/i);
    const u = await loadUser("teller1");
    expect(u.failedAttempts).toBe(1);
    expect(u.lockedUntil).toBeNull();
  });

  it("is still locked at 14 minutes", async () => {
    setClock(() => T0);
    await makeUser("TELLER", "teller1");
    await failLogins("teller1", 5);
    setClock(() => new Date(T0.getTime() + 14 * 60_000));
    await expect(signIn({ username: "teller1", password: TEST_PASSWORD })).rejects.toThrow(/locked/i);
  });

  it("unknown usernames get the generic message", async () => {
    await expect(signIn({ username: "nobody", password: TEST_PASSWORD })).rejects.toThrow("Invalid username or password");
  });

  it("public sign-up, e-mail sign-in and self-service profile endpoints are disabled", async () => {
    for (const path of ["sign-up/email", "sign-in/email", "update-user"]) {
      const res = await getAuth().handler(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email: "a@b.c", password: TEST_PASSWORD, name: "x" }),
        }),
      );
      expect(res.status, path).toBe(404);
    }
  });
});

describe("T1.4 auth guard", () => {
  it("no actor → UnauthenticatedError and an auth.denied row", async () => {
    await expect(requirePermission("audit.read")).rejects.toBeInstanceOf(UnauthenticatedError);
    const rows = await db().select().from(auditLog).where(eq(auditLog.action, "auth.denied"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBeNull();
  });

  it("deactivated users count as signed out", async () => {
    const admin = await makeUser("ADMIN", "admin1");
    const t = await makeUser("TELLER", "teller1");
    await runAs(admin.id, () => deactivateUserAction({ userId: t.id }));
    expect(await runAs(t.id, () => getCurrentUser())).toBeNull();
  });
});

describe("T1.5 audit", () => {
  it("records ip and user agent from the actor context; the viewer filters by user, action and date", async () => {
    setClock(() => T0);
    const admin = await makeUser("ADMIN", "admin1");
    await runAs(
      admin.id,
      () => createUserAction({ username: "teller9", fullName: "T9", roleCode: "TELLER", password: TEST_PASSWORD }),
      { ip: "10.0.0.5", userAgent: "vitest" },
    );
    const page = await listAuditLog({ userId: admin.id, action: "user.create", from: "2026-10-07", to: "2026-10-07" });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ username: "admin1", ip: "10.0.0.5", entity: "user" });
    expect((await listAuditLog({ action: "user.create", from: "2026-10-08" })).total).toBe(0);
  });
});

describe("T1.7 users admin rules", () => {
  it("blocks self-deactivation, self-demotion, duplicates and short passwords", async () => {
    const admin = await makeUser("ADMIN", "admin1");
    expect(await runAs(admin.id, () => deactivateUserAction({ userId: admin.id }))).toEqual({
      ok: false,
      error: "You can't deactivate yourself",
    });
    expect(
      await runAs(admin.id, () => updateUserAction({ userId: admin.id, fullName: "A", roleCode: "TELLER", email: null })),
    ).toEqual({ ok: false, error: "You can't change your own role" });
    expect(
      await runAs(admin.id, () =>
        createUserAction({ username: "admin1", fullName: "Dup", roleCode: "TELLER", password: TEST_PASSWORD }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/already taken/) });
    expect(
      await runAs(admin.id, () =>
        createUserAction({ username: "short", fullName: "S", roleCode: "TELLER", password: "123456789" }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/at least 10/) });
    expect((await loadUser("admin1")).roleCode).toBe("ADMIN");
  });

  it("keeps at least one active ADMIN (no deactivating or demoting the last one)", async () => {
    const a = await makeUser("ADMIN", "admin1");
    const b = await makeUser("ADMIN", "admin2");
    // a demotes b: allowed while a remains an active admin.
    expect(await runAs(a.id, () => updateUserAction({ userId: b.id, fullName: "B", roleCode: "TELLER", email: null }))).toEqual(OK);

    // The system (no actor) tries to remove the only remaining admin.
    await expect(withTx((tx) => setUserActive(tx, a.id, false, b.id))).rejects.toThrow(/last active administrator/);
    await expect(
      withTx((tx) => updateUser(tx, { userId: a.id, fullName: "A", email: null, roleCode: "TELLER" }, b.id)),
    ).rejects.toThrow(/last active administrator/);
    expect((await loadUser("admin1")).roleCode).toBe("ADMIN");
    expect((await loadUser("admin1")).isActive).toBe(true);
  });

  it("two admins deactivating each other at the same time leave one active admin", async () => {
    const a = await makeUser("ADMIN", "admin1");
    const b = await makeUser("ADMIN", "admin2");
    const results = await Promise.allSettled([
      runAs(a.id, () => deactivateUserAction({ userId: b.id })),
      runAs(b.id, () => deactivateUserAction({ userId: a.id })),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    expect(succeeded).toBe(1);
    const active = [await loadUser("admin1"), await loadUser("admin2")].filter((u) => u.isActive);
    expect(active).toHaveLength(1);
  });

  it("reset password clears a lockout and the new password works", async () => {
    setClock(() => T0);
    const admin = await makeUser("ADMIN", "admin1");
    const t = await makeUser("TELLER", "teller1");
    await failLogins("teller1", 5);

    expect(await runAs(admin.id, () => resetPasswordAction({ userId: t.id, password: "Brand-New-Pass-1" }))).toEqual(OK);
    await expect(signIn({ username: "teller1", password: TEST_PASSWORD })).rejects.toThrow(/invalid/i);
    await expect(signIn({ username: "teller1", password: "Brand-New-Pass-1" })).resolves.toBeTruthy();
  });
});

describe("T1.8 settings service", () => {
  it("updates with history and audit; rejects invalid values and unknown keys", async () => {
    const admin = await makeUser("ADMIN", "admin1");
    expect(await getSetting("water.due_days")).toBe(15);
    expect(await runAs(admin.id, () => updateSettingAction({ key: "water.due_days", value: 20 }))).toEqual(OK);
    expect(await getSetting("water.due_days")).toBe(20);
    const history = await settingHistory("water.due_days");
    expect(history[0]).toMatchObject({ oldValue: 15, newValue: 20, changedBy: admin.id });
    const rows = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "setting.update"), eq(auditLog.entityId, "water.due_days")));
    expect(rows).toHaveLength(1);

    expect(await runAs(admin.id, () => updateSettingAction({ key: "surplus.reserve_pct", value: "0.05" }))).toMatchObject({
      ok: false,
    });
    expect(await runAs(admin.id, () => updateSettingAction({ key: "no.such.key", value: 1 }))).toMatchObject({ ok: false });
  });
});

describe("T1.9 numbering", () => {
  it("opens a new year's row at 1; never-resetting series keep one counter", async () => {
    expect(await withTx((tx) => nextNumber("GJ", tx, "2026-12-31"))).toBe("GJ-2026-00001");
    expect(await withTx((tx) => nextNumber("GJ", tx, "2027-01-01"))).toBe("GJ-2027-00001");
    expect(await withTx((tx) => nextNumber("GJ", tx, "2026-12-31"))).toBe("GJ-2026-00002");
    expect(await withTx((tx) => nextNumber("MEMBER", tx, "2026-12-31"))).toBe("M-000001");
    expect(await withTx((tx) => nextNumber("MEMBER", tx, "2027-01-01"))).toBe("M-000002");
    const rows = await db().select().from(numberSeries).where(eq(numberSeries.code, "MEMBER"));
    expect(rows).toHaveLength(1);
    await expect(withTx((tx) => nextNumber("NOPE", tx))).rejects.toBeInstanceOf(NumberingError);
  });
});

describe("settings round-trip (regression: jsonb strings that look numeric)", () => {
  it("money and rate settings come back as strings, not numbers", async () => {
    expect(await getSetting("member.fee")).toBe("50000");
    expect(await getSetting("water.fee.connection")).toBe("350000");
    expect(await getSetting("savings.regular.rate_pa")).toBe("0.02");
    expect(await getSetting("coop.name")).toBe("Pipindan Community Multi-Purpose Cooperative");
  });
});
