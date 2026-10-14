import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("the bookkeeper opens Net surplus allocation: the funds and shares in force, and the CETF still to remit", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const book = { user: `bk15_${run.toLowerCase()}`, pass: `E2e-Book-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, book.user, "BOOKKEEPER", book.pass);
  await signOut(page);

  await signIn(page, book.user, book.pass);
  await page.goto("/year-end/surplus");
  await expect(page.getByRole("heading", { name: "Net surplus allocation" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Reserve fund", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Patronage refund", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CETF to remit" })).toBeVisible();
});
