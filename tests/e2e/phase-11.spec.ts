import { expect, test, type Page } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

async function approvedMember(page: Page, lastName: string, run: string): Promise<{ url: string; memberNo: string }> {
  await page.goto("/members/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Liza");
  await page.getByLabel("Birthdate").fill("1983-08-08");
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

test("A11.13 release → pay at the teller → the ledger card shows the balance", async ({ page }) => {
  test.setTimeout(300_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr11_${lc}`, pass: `E2e-Mgr-${run}` };
  const mgr2 = { user: `mgb11_${lc}`, pass: `E2e-Mgb-${run}` };
  const teller = { user: `tlr11_${lc}`, pass: `E2e-Teller-${run}` };
  const officer = { user: `lo11_${lc}`, pass: `E2e-Lo-${run}` };
  const borrower = `Mendoza${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, mgr2.user, "MANAGER", mgr2.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await createUser(page, officer.user, "LOAN_OFFICER", officer.pass);
  await signOut(page);

  await signIn(page, mgr.user, mgr.pass);
  const b = await approvedMember(page, borrower, run);
  await signOut(page);

  // Teller: opens the session with cash for the release; collects ₱2,500.00 paid-up and the fee.
  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  await page.getByLabel("Opening cash").fill("20000");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await page.getByLabel("Payor type").selectOption("MEMBER");
  await page.getByLabel("Search payor").fill(borrower);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(borrower) }).click();
  await page.locator("div", { hasText: /^Share capital · unpaid subscription/ }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Amount for Share capital/).fill("2500.00");
  await page.locator("div", { hasText: /^Membership fee/ }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("BIR receipt no.").fill(`G11-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await signOut(page);

  // Loan officer: an Emergency loan of ₱5,000.00 for 6 months; the manager approves it.
  await signIn(page, officer.user, officer.pass);
  await page.goto("/loans/applications/new");
  await page.getByLabel("Borrower member no.").fill(b.memberNo);
  await page.getByRole("button", { name: "Find borrower" }).click();
  await expect(page.getByText(/in good standing/)).toBeVisible();
  await page.getByLabel("Product").selectOption({ label: "Emergency Loan" });
  await page.getByLabel("Amount (₱)").fill("5000");
  await page.getByLabel("Term (months)").fill("6");
  await page.getByLabel("Purpose").fill("Medical");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByTestId("application-status")).toHaveText("SUBMITTED");
  const appUrl = page.url();
  await signOut(page);
  await signIn(page, mgr.user, mgr.pass);
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("application-status")).toHaveText("APPROVED");
  await signOut(page);

  // A second manager authorizes the release (never the approver).
  await signIn(page, mgr2.user, mgr2.pass);
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Authorize release" }).click();
  await expect(page.getByRole("heading", { name: /Loan LN-\d{4}-\d{5}/ })).toBeVisible();
  await expect(page.getByTestId("loan-status")).toHaveText("PENDING");
  const loanUrl = page.url();
  await signOut(page);

  // Teller: pays out the net proceeds (₱5,000.00 − 1% service fee = ₱4,950.00), then collects the first payment.
  await signIn(page, teller.user, teller.pass);
  await page.goto(loanUrl);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Pay out ₱4,950.00" }).click();
  await expect(page.getByTestId("loan-status")).toHaveText("ACTIVE");
  await expect(page.getByTestId("loan-outstanding")).toHaveText("₱5,000.00");

  await page.goto("/cashiering/teller");
  await page.getByLabel("Payor type").selectOption("MEMBER");
  await page.getByLabel("Search payor").fill(borrower);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(borrower) }).click();
  await page.locator("div", { hasText: /^Loan LN-\d{4}-\d{5}/ }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(/Amount for Loan LN-/).fill("908.33");
  await page.getByLabel("BIR receipt no.").fill(`L11-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();

  // The ledger card: add-on 1.5% × 6 = ₱450 interest; the first ₱908.33 pays ₱75.00 interest and ₱833.33 principal.
  await page.goto(loanUrl);
  await expect(page.getByTestId("loan-outstanding")).toHaveText("₱4,166.67");
  await expect(page.getByRole("row", { name: /^1 / })).toContainText("Paid");
});
