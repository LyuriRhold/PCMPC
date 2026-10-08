import { expect, test } from "@playwright/test";

const adminUser = process.env.SEED_ADMIN_USERNAME ?? "admin";
const adminPass = process.env.SEED_ADMIN_PASSWORD ?? "";

async function signIn(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("A2.10 encode applicant → approve → list shows ACTIVE with member no.", async ({ page }) => {
  // Unique per run: the dev database keeps earlier runs.
  const run = Date.now().toString(36);
  const managerName = `mgr_${run}`;
  const managerPass = `E2e-Manager-${run}`;
  const firstName = `Rosa${run}`;

  // Admin creates a MANAGER (encodes and approves members).
  await signIn(page, adminUser, adminPass);
  await page.goto("/admin/users");
  await page.getByLabel("Username").fill(managerName);
  await page.getByLabel("Full name").fill("E2E Manager");
  await page.getByLabel("Role").selectOption("MANAGER");
  await page.getByLabel("Initial password").fill(managerPass);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("cell", { name: managerName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // Manager encodes the application.
  await signIn(page, managerName, managerPass);
  await page.goto("/members/new");
  await page.getByLabel("Last name").fill("Mercado");
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Birthdate").fill("1985-03-14");
  await page.getByLabel("Sex").selectOption("FEMALE");
  await page.getByLabel("Civil status").selectOption("SINGLE");
  await page.getByLabel("Barangay").fill("Pipindan");
  await page.getByLabel("Municipality").fill("Binangonan");
  await page.getByLabel("Province").fill("Rizal");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Save application" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Mercado, ${firstName}`) })).toBeVisible();
  await expect(page.getByText("APPLICANT", { exact: true })).toBeVisible();

  // Approve from the profile.
  await page.getByLabel("PMES date").fill("2026-10-01");
  await page.getByLabel("BOD resolution no.").fill("2026-15");
  await page.getByRole("button", { name: "Approve membership" }).click();
  await expect(page.getByText(/Approved as M-\d{6}/)).toBeVisible();

  // The member list shows the member as ACTIVE with a member number.
  await page.goto(`/members?q=${firstName}`);
  const row = page.getByRole("row", { name: new RegExp(firstName) });
  await expect(row).toContainText("ACTIVE");
  await expect(row).toContainText(/M-\d{6}/);
});
