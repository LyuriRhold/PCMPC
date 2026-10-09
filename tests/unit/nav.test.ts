import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS, comingSoonItem, PHASES, visibleHrefs } from "@/components/layout/nav";

/** The page file that serves an href, if one exists (staff group first, then top-level routes). */
function pageFileFor(href: string): string | null {
  const parts = href.split("/").filter(Boolean);
  for (const base of ["src/app/(staff)", "src/app/(reader)", "src/app"]) {
    const file = join(base, ...parts, "page.tsx");
    if (existsSync(file)) return file;
  }
  return null;
}

describe("module registry (sidebar, dashboard, coming-soon pages)", () => {
  it("has unique hrefs and known phases", () => {
    const hrefs = ALL_NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const i of ALL_NAV_ITEMS) expect(PHASES[i.phase], i.href).toBeDefined();
  });

  it("every live item has a real page; no planned item is shadowed by a real page", () => {
    for (const i of ALL_NAV_ITEMS) {
      if (i.status === "live") expect(pageFileFor(i.href), `${i.href} is live but has no page`).not.toBeNull();
      else expect(pageFileFor(i.href), `${i.href} has a page; mark it live`).toBeNull();
    }
  });

  it("comingSoonItem resolves only planned paths", () => {
    expect(comingSoonItem("/share")?.phase).toBe("08");
    expect(comingSoonItem("/admin/users")).toBeUndefined();
    expect(comingSoonItem("/no/such/page")).toBeUndefined();
  });

  it("live items need their permission; coming-soon items are visible to everyone", () => {
    const none = visibleHrefs(new Set());
    expect(none).toContain("/share");
    expect(none).toContain("/");
    expect(none).not.toContain("/admin/users");
    expect(visibleHrefs(new Set(["admin.users"]))).toContain("/admin/users");
  });
});
