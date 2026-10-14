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

test("the bookkeeper adds an asset brought forward from the books before and voids a wrongly registered one", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const book = { user: `fa14_${run.toLowerCase()}`, pass: `E2e-Book-${run}` };
  const year = new Date().getFullYear();

  await signIn(page, adminUser, adminPass);
  await createUser(page, book.user, "BOOKKEEPER", book.pass);
  await signOut(page);
  await signIn(page, book.user, book.pass);

  const add = async (tag: string, acquired: string, opening?: { amount: string; through: string }) => {
    await page.getByLabel("Asset tag").fill(tag);
    await page.getByLabel("Description").fill("Photocopier");
    await page.getByLabel("Class", { exact: true }).selectOption("OFFICE_EQUIPMENT");
    await page.getByLabel("Acquired on").fill(acquired);
    await page.getByLabel("Cost (₱)").fill("36,000.00");
    if (opening) {
      await page.getByLabel("Accumulated depreciation brought forward (₱)").fill(opening.amount);
      await page.getByLabel("Brought forward through").fill(opening.through);
    }
    await page.getByRole("button", { name: "Add to the register" }).click();
    await expect(page.getByText("Asset added.")).toBeVisible();
  };

  await page.goto("/accounting/fixed-assets");
  await expect(page.getByRole("heading", { name: "Fixed assets" })).toBeVisible();
  const old = `OLD-${run}`;
  await add(old, `${year - 2}-03-10`, { amount: "10,000.00", through: `${year - 1}-12` });
  await expect(page.getByRole("row", { name: new RegExp(old) })).toContainText(`₱10,000.00 brought forward; depreciated from ${year}-01`);

  await page.reload();
  const wrong = `WRONG-${run}`;
  await add(wrong, `${year}-01-15`);
  const row = page.getByRole("row", { name: new RegExp(wrong) });
  await row.getByPlaceholder("Why it is voided").fill("Registered twice");
  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Void" }).click();
  await expect(row.getByText("Voided")).toBeVisible();
  await expect(row).toContainText("Registered twice");
});
