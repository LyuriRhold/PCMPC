import { expect, test, type Page } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

/** Manager: an approved member; returns the member's profile URL and member no. */
async function approvedMember(page: Page, lastName: string, run: string): Promise<{ url: string; memberNo: string }> {
  await page.goto("/members/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Carmen");
  await page.getByLabel("Birthdate").fill("1980-04-04");
  await page.getByLabel("Sex").selectOption("FEMALE");
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
  const approved = page.getByText(/Approved as M-\d{6}/);
  await expect(approved).toBeVisible();
  const memberNo = (await approved.textContent())!.match(/M-\d{6}/)![0];
  const url = page.url().split("?")[0]!;
  await page.goto(`${url}?tab=share`);
  await page.getByLabel("Shares to subscribe").fill("100");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByTestId("share-subscribed")).toHaveText("₱10,000.00");
  return { url, memberNo };
}

/** Teller: ₱2,500.00 paid-up plus the ₱500.00 membership fee (good standing). */
async function payShareAndFee(page: Page, lastName: string, bir: string) {
  await page.goto("/cashiering/teller");
  await page.getByLabel("Payor type").selectOption("MEMBER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await page.locator("div", { hasText: /^Share capital · unpaid subscription/ }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Amount for Share capital/).fill("2500.00");
  await page.locator("div", { hasText: /^Membership fee/ }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("cart-total")).toHaveText("₱3,000.00");
  await page.getByLabel("BIR receipt no.").fill(bir);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
}

test("A10.11 the calculator shows A10.1 row 1; an application is submitted and approved by the manager", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr10_${lc}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr10_${lc}`, pass: `E2e-Teller-${run}` };
  const officer = { user: `lo10_${lc}`, pass: `E2e-Lo-${run}` };
  const borrower = `Villanueva${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await createUser(page, officer.user, "LOAN_OFFICER", officer.pass);
  await signOut(page);

  await signIn(page, mgr.user, mgr.pass);
  const b = await approvedMember(page, borrower, run);
  await signOut(page);

  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("0");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await payShareAndFee(page, borrower, `L10-${run}`);
  await signOut(page);

  // Loan officer: the calculator shows A10.1, then an Emergency loan (no comaker) is submitted.
  await signIn(page, officer.user, officer.pass);
  await page.goto("/loans/calculator");
  await page.getByLabel("Product").selectOption({ label: "Regular Loan" });
  await page.getByLabel("Amount (₱)").fill("10000");
  await page.getByLabel("Term (months)").fill("12");
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByTestId("calc-payment")).toHaveText("₱916.80");
  const row1 = page.getByRole("row", { name: /^1 / });
  await expect(row1).toContainText("₱150.00");
  await expect(row1).toContainText("₱766.80");
  await expect(row1).toContainText("₱9,233.20");

  await page.goto("/loans/applications/new");
  await page.getByLabel("Borrower member no.").fill(b.memberNo);
  await page.getByRole("button", { name: "Find borrower" }).click();
  await expect(page.getByText(new RegExp(`${borrower}.*in good standing`))).toBeVisible();
  await page.getByLabel("Product").selectOption({ label: "Emergency Loan" });
  await page.getByLabel("Amount (₱)").fill("5000");
  await page.getByLabel("Term (months)").fill("6");
  await page.getByLabel("Purpose").fill("Medical expenses");
  await expect(page.getByTestId("preview-payment")).toHaveText("₱908.33");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("heading", { name: /Loan application LA-\d{4}-\d{5}/ })).toBeVisible();
  await expect(page.getByTestId("application-status")).toHaveText("SUBMITTED");
  const appUrl = page.url();
  await signOut(page);

  // Manager: ₱5,000.00 is within the ₱30,000.00 limit, so the manager's approval approves it.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto(appUrl);
  await page.getByLabel("Remarks").fill("OK");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("application-status")).toHaveText("APPROVED");
  await page.getByRole("link", { name: "Disclosure statement" }).click();
  await expect(page.getByRole("heading", { name: "Disclosure Statement on Loan Transaction" })).toBeVisible();
  await expect(page.getByText("₱5,000.00").first()).toBeVisible();
});
