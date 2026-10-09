import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("A8.10 subscribe → pay at the teller → ledger shows paid-up", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr8_${lc}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr8_${lc}`, pass: `E2e-Teller-${run}` };
  const lastName = `Santiago${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await signOut(page);

  // Manager: a new member (applicant → approved), then a 100-share subscription.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/members/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Lorna");
  await page.getByLabel("Birthdate").fill("1985-03-14");
  await page.getByLabel("Sex").selectOption("FEMALE");
  await page.getByLabel("Civil status").selectOption("SINGLE");
  await page.getByLabel("Barangay").fill("Pipindan");
  await page.getByLabel("Municipality").fill("Binangonan");
  await page.getByLabel("Province").fill("Rizal");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Save application" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(lastName) })).toBeVisible();
  await page.getByLabel("PMES date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("BOD resolution no.", { exact: true }).fill(`BOD-${run}`);
  await page.getByRole("button", { name: "Approve membership" }).click();
  await expect(page.getByText(/Approved as M-\d{6}/)).toBeVisible();

  await page.getByRole("link", { name: "Share capital" }).click();
  await page.getByLabel("Shares to subscribe").fill("100");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByTestId("share-subscribed")).toHaveText("₱10,000.00");
  await expect(page.getByTestId("share-paid-up")).toHaveText("₱0.00");
  await signOut(page);

  // Teller: the unpaid subscription is a due; pay ₱2,500.00.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("0");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await page.getByLabel("Payor type").selectOption("MEMBER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await expect(page.getByText(/Share capital · unpaid subscription/)).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  // Pay part of it: edit the cart amount to ₱2,500.00.
  await page.getByLabel(/Amount for Share capital/).fill("2500.00");
  await expect(page.getByTestId("cart-total")).toHaveText("₱2,500.00");
  await page.getByLabel("BIR receipt no.").fill(`S8-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await signOut(page);

  // The member's share ledger shows the payment and the paid-up balance.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto(`/members?q=${lastName}`);
  await page.getByRole("link", { name: new RegExp(lastName) }).click();
  await page.getByRole("link", { name: "Share capital" }).click();
  await expect(page.getByTestId("share-paid-up")).toHaveText("₱2,500.00");
  await expect(page.getByRole("row", { name: /Payment/ })).toContainText("₱2,500.00");
});
