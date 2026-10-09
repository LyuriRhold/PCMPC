import { expect, test } from "@playwright/test";
import { activeAccountViaUi, adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("A7.14 teller → search water customer → pay bill → slip printed → account balance ₱0.00", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const clerk = { user: `clk7_${lc}`, pass: `E2e-Clerk-${run}` };
  const mgr = { user: `mgr7_${lc}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr7_${lc}`, pass: `E2e-Teller-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, clerk.user, "BILLING_CLERK", clerk.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await signOut(page);

  const { accountNo, zone, lastName } = await activeAccountViaUi(page, { run, clerk, mgr, teller, initialReading: 100 });

  // Clerk reads the meter (118 → 18 m³) and posts the zone's billing run: ₱400.00.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/readings");
  await page.getByRole("row", { name: new RegExp(zone) }).getByRole("link", { name: "Readings" }).click();
  await page.getByLabel(`Present reading for ${accountNo}`).fill("118");
  await page.getByRole("button", { name: `Save reading for ${accountNo}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(accountNo) })).toContainText("APPROVED");
  await page.goto("/water/billing");
  await page.getByRole("row", { name: new RegExp(zone) }).getByRole("link", { name: "Bill" }).click();
  await page.getByRole("button", { name: "Post billing run" }).click();
  await expect(page.getByText(/Billed: 1 bill/)).toBeVisible();
  await signOut(page);

  // Teller: find the customer, add the water bill due, issue the receipt.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await expect(page.getByText("Session open")).toBeVisible();
  await page.getByLabel("Payor type").selectOption("WATER_CUSTOMER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await expect(page.getByText(new RegExp(`Water bills · ${accountNo}`))).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("₱400.00");
  await page.getByLabel("BIR receipt no.").fill(`W7-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`${accountNo}.*balance after payment ₱0\\.00`))).toBeVisible();
  await signOut(page);

  // The account's balance is ₱0.00.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/connections");
  await page.getByRole("link", { name: accountNo, exact: true }).first().click();
  await expect(page.getByTestId("account-balance")).toHaveText("₱0.00");
});
