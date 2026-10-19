import { expect, test } from "@playwright/test";

const username = process.env.SEED_ADMIN_USERNAME || "admin";
const password = process.env.SEED_ADMIN_PASSWORD || "Pass123456";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("planned screens show the under-construction page with their phase", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: /CDA reports/ }).click();
  await expect(page).toHaveURL(/\/reports\/cda$/);
  await expect(page.getByRole("heading", { name: "CDA reports" })).toBeVisible();
  await expect(page.getByText("Coming soon: under construction")).toBeVisible();
  await expect(page.getByText(/planned for Phase 16: Reports: CDA, Management, Member/)).toBeVisible();
});

test("the dashboard lists live and coming-soon modules; unknown paths are 404", async ({ page }) => {
  await expect(page.getByRole("link", { name: /CDA reports.*Soon · P16/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Coop settings.*Live/ })).toBeVisible();

  await page.goto("/water/no-such-screen");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText("Coming soon: under construction")).toHaveCount(0);
});

test("the super admin views the system as another role, then as the administrator again", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Coop settings/ })).toBeVisible();
  await page.getByLabel("View as role").selectOption("TELLER");
  await expect(page.getByRole("status").filter({ hasText: "viewing the system as" })).toContainText("Cashier / Teller");
  await expect(nav.getByRole("link", { name: /Coop settings/ })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page.getByText(/admin.settings/).first()).toBeVisible();
  await page.getByRole("button", { name: "Back to Administrator" }).click();
  await expect(page.getByText("viewing the system as")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /Coop settings/ })).toBeVisible();
});
