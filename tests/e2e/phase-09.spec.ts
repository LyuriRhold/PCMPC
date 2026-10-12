import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("A9.11 open account → deposit and withdraw at the teller → ledger shows balances", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr9_${lc}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr9_${lc}`, pass: `E2e-Teller-${run}` };
  const lastName = `Garcia${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await signOut(page);

  // Manager: a new member (applicant → approved).
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/members/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Jose");
  await page.getByLabel("Birthdate").fill("1982-11-20");
  await page.getByLabel("Sex").selectOption("MALE");
  await page.getByLabel("Civil status").selectOption("MARRIED");
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
  const memberUrl = page.url().split("?")[0]!;
  await signOut(page);

  // Teller: open the member's savings account, then a ₱10,000.00 deposit on a receipt.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("0");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await page.goto(`${memberUrl}?tab=savings`);
  await page.getByRole("button", { name: "Open savings account" }).click();
  await expect(page.getByTestId("savings-balance")).toHaveText("₱0.00");

  await page.goto("/cashiering/teller");
  await page.getByLabel("Payor type").selectOption("MEMBER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await page.locator("div", { hasText: /^Savings deposit · SA-\d{6}/ }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Amount for Savings deposit/).fill("10000.00");
  await expect(page.getByTestId("cart-total")).toHaveText("₱10,000.00");
  await page.getByLabel("BIR receipt no.").fill(`S9-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();

  // Teller: a ₱3,000.00 withdrawal paid out from the drawer.
  await page.goto(`${memberUrl}?tab=savings`);
  await expect(page.getByTestId("savings-balance")).toHaveText("₱10,000.00");
  await page.getByLabel("Withdrawal amount").fill("3000.00");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByTestId("savings-balance")).toHaveText("₱7,000.00");

  // The account ledger shows each movement with the balance after it.
  await expect(page.getByRole("row", { name: /Deposit/ })).toContainText("₱10,000.00");
  await expect(page.getByRole("row", { name: /Withdrawal/ })).toContainText("₱7,000.00");
});

test("savings products and the interest-run preview open for the right roles", async ({ page }) => {
  const run = Date.now().toString(36).toUpperCase();
  const book = { user: `bk9_${run.toLowerCase()}`, pass: `E2e-Book-${run}` };

  // Admin: the products page shows the rates and limits as a form; saving keeps them.
  await signIn(page, adminUser, adminPass);
  await page.goto("/savings/products");
  await expect(page.getByRole("heading", { name: "Savings products" })).toBeVisible();
  const regular = page.locator("form", { has: page.getByLabel("Maintaining balance (₱)") });
  await expect(regular.getByLabel("Interest rate (% a year)")).toHaveValue("2");
  await regular.getByRole("button", { name: "Save" }).click();
  await expect(regular.getByText("Saved.")).toBeVisible();
  // The coop settings point to it for savings rates.
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: "Open Savings products" }).first()).toBeVisible();
  await createUser(page, book.user, "BOOKKEEPER", book.pass);
  await signOut(page);

  // Bookkeeper: the interest-run preview for the last quarter.
  await signIn(page, book.user, book.pass);
  await page.goto("/savings/interest");
  await expect(page.getByRole("heading", { name: "Savings interest runs" })).toBeVisible();
  await expect(page.getByLabel("Quarter ending")).toBeVisible();
  await expect(page.getByText("Posted runs", { exact: true })).toBeVisible();
});
