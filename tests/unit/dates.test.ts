import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  businessToday,
  daysBetween,
  formatDate,
  isBusinessDate,
  monthEnd,
  quarterOf,
  setClock,
} from "@/lib/dates";

afterEach(() => setClock(null));

describe("businessToday (Asia/Manila, UTC+8)", () => {
  it.each([
    ["2026-10-06T15:59:59Z", "2026-10-06"],
    ["2026-10-06T16:00:00Z", "2026-10-07"],
    ["2026-10-07T15:59:59Z", "2026-10-07"],
    ["2026-12-31T16:00:00Z", "2027-01-01"],
    ["2028-02-28T16:00:00Z", "2028-02-29"],
  ])("at %s → %s", (instant, expected) => {
    expect(businessToday(new Date(instant))).toBe(expected);
  });

  it("uses the injected clock when called without arguments", () => {
    setClock(() => new Date("2026-10-06T16:30:00Z"));
    expect(businessToday()).toBe("2026-10-07");
    setClock(null);
    expect(isBusinessDate(businessToday())).toBe(true);
  });

  it("does not depend on the machine time zone (tests run with TZ=UTC)", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(businessToday(new Date("2026-10-06T23:00:00Z"))).toBe("2026-10-07");
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-01-15", 1, "2026-02-15"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-11-30", 2, "2027-01-30"],
    ["2026-01-31", 12, "2027-01-31"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-01-15", -1, "2025-12-15"],
    ["2026-05-31", 0, "2026-05-31"],
  ])("%s + %i mo → %s", (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it("does not drift when stepping month by month from the 31st (each step from the start date)", () => {
    const start = "2026-01-31";
    const due = Array.from({ length: 4 }, (_, i) => addMonths(start, i + 1));
    expect(due).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });
});

describe("addDays / daysBetween", () => {
  it("counts actual days", () => {
    expect(daysBetween("2026-01-01", "2026-04-01")).toBe(90);
    expect(daysBetween("2028-01-01", "2028-04-01")).toBe(91);
    expect(daysBetween("2026-04-01", "2026-01-01")).toBe(-90);
    expect(daysBetween("2026-10-07", "2026-10-07")).toBe(0);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-07", 30)).toBe("2026-11-06");
  });
});

describe("monthEnd / quarterOf / formatDate", () => {
  it("monthEnd", () => {
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(monthEnd("2100-02-01")).toBe("2100-02-28");
    expect(monthEnd("2000-02-01")).toBe("2000-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });

  it("quarterOf", () => {
    expect(["2026-01-01", "2026-03-31", "2026-04-01", "2026-09-30", "2026-10-07", "2026-12-31"].map(quarterOf)).toEqual([
      1, 1, 2, 3, 4, 4,
    ]);
  });

  it("formatDate", () => {
    expect(formatDate("2026-10-07")).toBe("Oct 07, 2026");
    expect(formatDate("2027-01-01")).toBe("Jan 01, 2027");
  });
});

describe("validation", () => {
  it.each(["2026-02-29", "2026-13-01", "2026-00-10", "2026-1-1", "07/10/2026", "", "1899-12-31"])("rejects %j", (bad) => {
    expect(isBusinessDate(bad)).toBe(false);
    expect(() => addDays(bad, 1)).toThrow(/Invalid business date/);
  });

  it("rejects fractional month/day steps", () => {
    expect(() => addMonths("2026-01-01", 1.5)).toThrow();
    expect(() => addDays("2026-01-01", 0.5)).toThrow();
  });
});
