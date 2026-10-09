import { expect, test } from "@playwright/test";

const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("planned screens show the under-construction page with their phase", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: /Collections & penalties/ }).click();
  await expect(page).toHaveURL(/\/water\/collections$/);
  await expect(page.getByRole("heading", { name: "Collections & penalties" })).toBeVisible();
  await expect(page.getByText("Coming soon: under construction")).toBeVisible();
  await expect(page.getByText(/planned for Phase 07: Water: Collections, Penalties & Disconnection/)).toBeVisible();
});

test("the dashboard lists live and coming-soon modules; unknown paths are 404", async ({ page }) => {
  await expect(page.getByRole("link", { name: /Collections & penalties.*Soon · P07/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Coop settings.*Live/ })).toBeVisible();

  await page.goto("/water/no-such-screen");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText("Coming soon: under construction")).toHaveCount(0);
});
