import { expect, test } from "@playwright/test";

const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";

test("A1.10 login as admin → dashboard → Users → logout; protected URL redirects to login", async ({ page }) => {
  expect(password, "SEED_ADMIN_PASSWORD must be set for E2E").not.toBe("");

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login/);
});
