import { describe, expect, it } from "vitest";
import { maskSensitive, maskTail, MASKED_DATE } from "@/modules/members/masking";
import { memberInputSchema, pctToHundredths } from "@/modules/members/validation";

describe("masking", () => {
  it("keeps only the last 4 characters", () => {
    expect(maskTail("1234-5678-9012-3456")).toBe("•••••••••••••••3456");
    expect(maskTail("123")).toBe("•••");
    expect(maskTail(null)).toBeNull();
  });

  it("masks birthdate, ID no., TIN and mobile", () => {
    expect(maskSensitive({ birthdate: "1990-05-10", validIdNo: "AB12345678", tin: "123-456-789-000", mobile: "09171234567", lastName: "X" })).toEqual({
      birthdate: MASKED_DATE,
      validIdNo: "••••••5678",
      tin: "•••••••••••-000",
      mobile: "•••••••4567",
      lastName: "X",
    });
  });
});

describe("validation", () => {
  it("percent to hundredths is exact", () => {
    expect(pctToHundredths("60")).toBe(6000);
    expect(pctToHundredths("33.33")).toBe(3333);
    expect(pctToHundredths("0.5")).toBe(50);
    expect(pctToHundredths("100")).toBe(10000);
  });

  it("requires names, birthdate and address; blanks become null", () => {
    const base = {
      type: "REGULAR" as const,
      lastName: " Dela Cruz ",
      firstName: "Juan",
      birthdate: "1990-05-10",
      sex: "MALE" as const,
      civilStatus: "SINGLE" as const,
      addrBarangay: "Pipindan",
      addrMunicipality: "Binangonan",
      addrProvince: "Rizal",
      middleName: "",
      email: "",
    };
    const parsed = memberInputSchema.parse(base);
    expect(parsed.lastName).toBe("Dela Cruz");
    expect(parsed.middleName).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.privacyConsent).toBe(false);
    expect(memberInputSchema.safeParse({ ...base, lastName: "  " }).success).toBe(false);
    expect(memberInputSchema.safeParse({ ...base, birthdate: "1990-02-30" }).success).toBe(false);
    expect(memberInputSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
});
