import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("management sees the dashboard, the reports and a member statement; the CAPR workbook downloads", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const gm = { user: `gm16_${run.toLowerCase()}`, pass: `E2e-Gm-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, gm.user, "MANAGER", gm.pass);
  await signOut(page);
  await signIn(page, gm.user, gm.pass);

  await page.goto("/reports/management");
  await expect(page.getByRole("heading", { name: "Management dashboard" })).toBeVisible();
  await expect(page.getByText("Loan portfolio").first()).toBeVisible();
  await expect(page.getByText("Paid-up share capital").first()).toBeVisible();

  await page.goto("/reports/operational");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await page.getByRole("link", { name: "Delinquency" }).click();
  await expect(page.getByRole("heading", { name: "Delinquency" })).toBeVisible();

  await page.goto("/reports/cda");
  await expect(page.getByRole("heading", { name: "CDA reports" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /CAPR workbook/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  await page.goto("/reports/statements");
  await expect(page.getByRole("heading", { name: "Member statements" })).toBeVisible();
});
