import { describe, expect, it } from "vitest";
import { effectiveRole, PERMISSIONS, ROLE_PERMISSIONS } from "@/modules/auth/permissions";

describe("the super admin", () => {
  it("holds every permission", () => {
    expect([...ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("may view the system as any other role; nobody else can switch, and no switch goes up", () => {
    expect(effectiveRole("ADMIN", "TELLER")).toBe("TELLER");
    expect(effectiveRole("ADMIN", "MANAGER")).toBe("MANAGER");
    expect(effectiveRole("ADMIN", null)).toBe("ADMIN");
    expect(effectiveRole("ADMIN", "ADMIN")).toBe("ADMIN");
    expect(effectiveRole("ADMIN", "OWNER")).toBe("ADMIN");
    expect(effectiveRole("TELLER", "ADMIN")).toBe("TELLER");
    expect(effectiveRole("MANAGER", "BOOKKEEPER")).toBe("MANAGER");
  });
});
