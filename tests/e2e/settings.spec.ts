import { expect, test } from "@playwright/test";
import { adminPass, adminUser, signIn } from "./water-setup";

test("coop settings read in plain language and can be changed without codes", async ({ page }, info) => {
  await signIn(page, adminUser, adminPass);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Coop settings" })).toBeVisible();

  // Plain values; no internal keys or JSON.
  await expect(page.getByTestId("setting-water.penalty_pct")).toHaveText("10% of the unpaid bill");
  await expect(page.getByTestId("setting-water.bill_paper")).toContainText("bond");
  await expect(page.getByText("water.penalty_pct")).toHaveCount(0);
  await expect(page.getByText("{\"")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Tariffs & fees" }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("settings.png"), fullPage: true });
  await page.locator("section", { has: page.getByRole("heading", { name: "Water", exact: true }) }).screenshot({ path: info.outputPath("water.png") });

  // The harder settings open as small forms (no JSON).
  await page.getByRole("button", { name: "Change Other income the teller can collect" }).click();
  await expect(page.getByLabel("Row 1 Income account")).toBeVisible();
  const cashSection = page.locator("section", { has: page.getByRole("heading", { name: "Cashiering", exact: true }) });
  await cashSection.screenshot({ path: info.outputPath("cash-edit.png") });
  await cashSection.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Change Flag high water use" }).click();
  await expect(page.getByLabel("Flag when usage is more than")).toHaveValue("2.0");
  await page.locator("section", { has: page.getByRole("heading", { name: "Water", exact: true }) }).screenshot({ path: info.outputPath("water-edit.png") });
  await page.getByRole("button", { name: "Cancel" }).click();

  // Change "Lock time" to 20 minutes, then back.
  const lock = page.getByTestId("setting-auth.lockout_minutes");
  const before = (await lock.textContent()) ?? "15 minutes";
  await page.getByRole("button", { name: "Change Lock time" }).click();
  await page.getByLabel("Lock time").fill("20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(lock).toHaveText("20 minutes");

  // A mistake is explained in plain words.
  await page.getByRole("button", { name: "Change Lock time" }).click();
  await page.getByLabel("Lock time").fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Lock time: must be at least 1")).toBeVisible();
  await page.getByLabel("Lock time").fill(before.replace(/\D/g, ""));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(lock).toHaveText(before);
});
