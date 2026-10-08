import { expect, test, type Page } from "@playwright/test";

const adminUser = process.env.SEED_ADMIN_USERNAME ?? "admin";
const adminPass = process.env.SEED_ADMIN_PASSWORD ?? "";

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function createUser(page: Page, username: string, role: string, password: string) {
  await page.goto("/admin/users");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Full name").fill(`E2E ${role}`);
  await page.getByLabel("Role").selectOption(role);
  await page.getByLabel("Initial password").fill(password);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();
}

test("A4.11 open session → multi-item receipt → close with count → manager verifies", async ({ page }) => {
  const run = Date.now().toString(36);
  const teller = { user: `tlr_${run}`, pass: `E2e-Teller-${run}` };
  const mgr = { user: `mgr_${run}`, pass: `E2e-Mgr-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await page.getByRole("button", { name: "Sign out" }).click();

  // Teller opens a session.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("1000");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();

  // Walk-in payor, two OTHER_INCOME items on one receipt.
  await page.getByLabel("Payor type").selectOption("WALK_IN");
  await page.getByLabel("Payor name").fill(`E2E Walk-in ${run}`);
  await page.getByLabel("Income item").selectOption("CERT_FEE");
  await page.getByLabel("Amount").fill("50");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Income item").selectOption("HALL_RENTAL");
  await page.getByLabel("Amount").fill("1500");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByTestId("cart-total")).toHaveText("₱1,550.00");
  await page.getByLabel("BIR receipt no.").fill(`E2E-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByText("₱1,550.00").first()).toBeVisible();

  // Close the session with a cash count: 1,000 opening + 1,550 receipt = 2,550.
  await page.goto("/cashiering/teller/close");
  await page.getByLabel("₱1,000 bills").fill("2");
  await page.getByLabel("₱500 bills").fill("1");
  await page.getByLabel("₱50 bills").fill("1");
  await expect(page.getByTestId("count-total")).toHaveText("₱2,550.00");
  await page.getByRole("button", { name: "Close session" }).click();
  await expect(page.getByText(/Variance: ₱0\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // Manager verifies.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/cashiering/sessions");
  const row = page.getByRole("row", { name: new RegExp(teller.user) });
  await row.getByRole("button", { name: "Verify" }).click();
  await expect(row).toContainText("VERIFIED");
});
