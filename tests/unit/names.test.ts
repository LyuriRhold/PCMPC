import { describe, expect, it } from "vitest";
import { nameKey, normalizeName } from "@/lib/names";

describe("normalizeName", () => {
  it.each([
    ["Juan", "juan"],
    ["  JUAN  ", "juan"],
    ["dela  cruz", "dela cruz"],
    ["Dela-Cruz", "dela cruz"],
    ["Peñaranda", "penaranda"],
    ["José María", "jose maria"],
    ["O'Brien, Jr.", "o brien jr"],
    ["", ""],
    [null, ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("nameKey matches case, accent and spacing variants", () => {
    expect(nameKey("dela  cruz", "JUAN ")).toBe(nameKey("Dela Cruz", "Juan"));
    expect(nameKey("Peñaranda", "José")).toBe(nameKey("PENARANDA", "jose"));
    expect(nameKey("Cruz", "Juan Dela")).not.toBe(nameKey("Dela Cruz", "Juan"));
  });
});
