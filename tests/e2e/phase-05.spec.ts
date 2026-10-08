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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
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

test("A5.12 non-member applies → approve → pay fees at the teller → install meter → account ACTIVE in the route list", async ({ page }) => {
  const run = Date.now().toString(36);
  const clerk = { user: `clk_${run}`, pass: `E2e-Clerk-${run}` };
  const mgr = { user: `mgr_${run}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr_${run}`, pass: `E2e-Teller-${run}` };
  const lastName = `Ramos${run}`;
  const meter = `SN-E2E-${run}`.toUpperCase();

  await signIn(page, adminUser, adminPass);
  await createUser(page, clerk.user, "BILLING_CLERK", clerk.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await signOut(page);

  // Billing clerk: new non-member customer and application; adds a meter to inventory.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/customers/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Elena");
  await page.getByLabel("Address").fill("Purok 4, Pipindan, Binangonan, Rizal");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${lastName}, Elena`) })).toBeVisible();
  await page.getByLabel("Service address").fill("Purok 4, Pipindan");
  await page.getByRole("button", { name: "File application" }).click();
  await expect(page.getByText(/WAPP-\d{4}-\d{5}/).first()).toBeVisible();

  await page.goto("/water/connections");
  await page.getByLabel("Serial no.").fill(meter);
  await page.getByRole("button", { name: "Add meter" }).click();
  await expect(page.getByRole("cell", { name: meter, exact: true })).toBeVisible();
  await signOut(page);

  // Manager approves the application.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/water/applications");
  const appRow = page.getByRole("row", { name: new RegExp(lastName) });
  await appRow.getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Approve application" }).click();
  await expect(page.getByText(/Approved: account WA-\d{6}/)).toBeVisible();
  await signOut(page);

  // Teller collects the connection fee and meter deposit.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("0");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await page.getByLabel("Payor type").selectOption("WATER_CUSTOMER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("₱4,500.00");
  await page.getByLabel("BIR receipt no.").fill(`W-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await signOut(page);

  // Clerk installs the meter; the account becomes ACTIVE and shows in its route.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/applications");
  await page.getByRole("row", { name: new RegExp(lastName) }).getByRole("link", { name: "Review" }).click();
  await page.getByLabel("Meter serial no.").fill(meter);
  await page.getByLabel("Initial reading").fill("0");
  await page.getByRole("button", { name: "Install meter" }).click();
  await expect(page.getByText(/Installed: account WA-\d{6} is ACTIVE/)).toBeVisible();

  await page.goto("/water/routes");
  const routeRow = page.getByRole("row", { name: new RegExp(lastName) });
  await expect(routeRow).toContainText("ACTIVE");
});
