import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("the bookkeeper opens the financial statements, exports them, and sees the month-close checklist", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const book = { user: `bk14_${run.toLowerCase()}`, pass: `E2e-Book-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, book.user, "BOOKKEEPER", book.pass);
  await signOut(page);

  await signIn(page, book.user, book.pass);
  await page.goto("/accounting/statements");
  await expect(page.getByRole("heading", { name: "Financial statements" })).toBeVisible();
  await expect(page.getByTestId("fs-balanced")).toHaveText("Balanced");
  await expect(page.getByRole("cell", { name: "Total assets", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Operations" }).click();
  await expect(page.getByRole("cell", { name: "Net surplus", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Excel (.xlsx)" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  await page.goto("/accounting/close");
  await expect(page.getByRole("heading", { name: "Period close" })).toBeVisible();
  await expect(page.getByText("Teller sessions verified").first()).toBeVisible();
});
