import { describe, expect, it } from "vitest";
import { sanitizeForAudit } from "@/lib/audit";
import { formatDateTime, startOfBusinessDay } from "@/lib/dates";
import { counterWidth, formatNumber } from "@/lib/numbering";
import { isPermission, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@/modules/auth/permissions";
import { NUMBER_SERIES } from "@/modules/numbering/series";
import { SETTING_KEYS, SETTINGS } from "@/modules/settings/registry";

describe("sanitizeForAudit", () => {
  it("drops secret-looking keys at any depth and serializes bigint/Date", () => {
    const out = sanitizeForAudit({
      username: "teller1",
      password: "x",
      passwordHash: "y",
      nested: { accessToken: "t", apiSecret: "s", amount: 123456n, at: new Date("2026-10-07T01:00:00Z") },
      list: [{ salt: "z", ok: 1 }],
      passbookNo: "PB-1",
      skipped: undefined,
    });
    expect(out).toEqual({
      username: "teller1",
      nested: { amount: "123456", at: "2026-10-07T01:00:00.000Z" },
      list: [{ ok: 1 }],
      passbookNo: "PB-1",
    });
  });
});

describe("numbering formats", () => {
  it.each([
    ["GJ-{YYYY}-{00000}", 7, "2026-10-07", "GJ-2026-00007"],
    ["WB-{YYYYMM}-{000000}", 1, "2026-10-07", "WB-202610-000001"],
    ["M-{000000}", 123, "2026-10-07", "M-000123"],
    ["AR-{YYYY}-{000000}", 999999, "2027-01-01", "AR-2027-999999"],
  ])("%s #%i on %s → %s", (format, no, date, expected) => {
    expect(formatNumber(format, no, date)).toBe(expected);
  });

  it("rejects overflow and formats without a counter", () => {
    expect(() => formatNumber("GJ-{YYYY}-{00}", 100, "2026-01-01")).toThrow(/overflowed/);
    expect(() => formatNumber("GJ-{YYYY}", 1, "2026-01-01")).toThrow(/counter/);
    expect(counterWidth("SA-{000000}")).toBe(6);
  });

  it("every DOMAIN §5 series has a valid format and a unique code", () => {
    expect(new Set(NUMBER_SERIES.map((s) => s.code)).size).toBe(NUMBER_SERIES.length);
    for (const s of NUMBER_SERIES) expect(() => formatNumber(s.format, 1, "2026-10-07")).not.toThrow();
  });
});

describe("permission matrix", () => {
  it("covers every PLAN §3 role and grants only catalogued permissions", () => {
    expect(ROLES.map((r) => r.code).sort()).toEqual(Object.keys(ROLE_PERMISSIONS).sort());
    expect(ROLES).toHaveLength(11);
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(isPermission(p)).toBe(true);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("keeps the read-only roles free of mutation permissions", () => {
    expect(ROLE_PERMISSIONS.AUDITOR.every((p) => /\.read$|\.read_sensitive$|^reports\.|^audit\./.test(p))).toBe(true);
    expect(ROLE_PERMISSIONS.BOARD).toEqual(["reports.read"]);
    expect(ROLE_PERMISSIONS.METER_READER).toEqual(["water.read_meter"]);
  });
});

describe("settings registry", () => {
  it("every default satisfies its own schema", () => {
    for (const key of SETTING_KEYS) {
      const r = SETTINGS[key].schema.safeParse(SETTINGS[key].default);
      expect(r.success, key).toBe(true);
    }
  });

  it("enforces RA 9520 bounds and value shapes", () => {
    expect(SETTINGS["surplus.reserve_pct"].schema.safeParse("0.09").success).toBe(false);
    expect(SETTINGS["surplus.etf_pct"].schema.safeParse("0.11").success).toBe(false);
    expect(SETTINGS["surplus.cdf_pct"].schema.safeParse("0.03").success).toBe(true);
    expect(SETTINGS["surplus.optional_pct"].schema.safeParse("0.075").success).toBe(false);
    expect(SETTINGS["member.fee"].schema.safeParse("500.00").success).toBe(false);
    expect(SETTINGS["member.fee"].schema.safeParse("-1").success).toBe(false);
    expect(SETTINGS["fiscal.year_start_month"].schema.safeParse(13).success).toBe(false);
    for (const bad of ["abc", "2%", "-0.1", "", "0.1.2"]) {
      expect(SETTINGS["surplus.etf_pct"].schema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("seeds the DOMAIN §2 values exactly", () => {
    expect(SETTINGS["member.fee"].default).toBe("50000");
    expect(SETTINGS["share.min_paid_up_regular"].default).toBe("250000");
    expect(SETTINGS["loan.manager_approval_limit"].default).toBe("3000000");
    expect(SETTINGS["water.fee.connection"].default).toBe("350000");
    expect(SETTINGS["water.tariff.RESIDENTIAL"].default.minimumCharge).toBe("20000");
    expect(SETTINGS["auth.max_failed_logins"].default).toBe(5);
    expect(SETTINGS["auth.lockout_minutes"].default).toBe(15);
  });
});

describe("business-day instants", () => {
  it("Manila midnight and display", () => {
    expect(startOfBusinessDay("2026-10-07").toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(formatDateTime(new Date("2026-10-07T01:30:00Z"))).toBe("Oct 07, 2026 09:30");
  });
});
