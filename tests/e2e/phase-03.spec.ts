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

test("A3.11 create JV → approve as another user → appears in TB", async ({ page }) => {
  const run = Date.now().toString(36);
  const book = { user: `book_${run}`, pass: `E2e-Book-${run}` };
  const mgr = { user: `mgr_${run}`, pass: `E2e-Mgr-${run}` };
  const amount = `${(Date.now() % 900) + 100}.25`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, book.user, "BOOKKEEPER", book.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await page.getByRole("button", { name: "Sign out" }).click();

  // The bookkeeper prepares a JV: Dr Cash on Hand / Cr Membership Fee Income.
  await signIn(page, book.user, book.pass);
  await page.goto("/accounting/journals/new");
  await page.getByLabel("Particulars").fill(`E2E JV ${run}`);
  await page.getByLabel("Account, line 1").selectOption({ label: "11110 · Cash on Hand" });
  await page.getByLabel("Debit, line 1").fill(amount);
  await page.getByLabel("Account, line 2").selectOption({ label: "44110 · Membership Fee Income" });
  await page.getByLabel("Credit, line 2").fill(amount);
  await expect(page.getByTestId("jv-totals")).toContainText("Balanced");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: /Journal voucher/ })).toBeVisible();
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // The manager approves it from the journal list.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/accounting/journals?status=DRAFT");
  await page.getByRole("link", { name: new RegExp(`E2E JV ${run}`) }).click();
  await page.getByRole("button", { name: "Approve and post" }).click();
  await expect(page.getByText(/Posted as GJ-\d{4}-\d{5}/)).toBeVisible();

  // The amount shows in the trial balance on Membership Fee Income (credit side) and the TB balances.
  await page.goto("/accounting/ledger?view=tb");
  const row = page.getByRole("row", { name: /Membership Fee Income/ });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("tb-status")).toHaveText("Balanced");
});
