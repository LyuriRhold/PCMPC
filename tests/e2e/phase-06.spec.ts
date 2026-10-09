import { expect, test, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";

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

async function pdfText(page: Page, href: string): Promise<string> {
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const pdf = await getDocumentProxy(new Uint8Array(await res.body()));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

test("A6.13 open period → print route sheet → encode readings → approve flags → billing run → bill PDF for 18 m³ shows ₱400.00", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  const clerk = { user: `clk6_${run}`.toLowerCase(), pass: `E2e-Clerk-${run}` };
  const mgr = { user: `mgr6_${run}`.toLowerCase(), pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr6_${run}`.toLowerCase(), pass: `E2e-Teller-${run}` };
  const zone = `Z${run}`;
  const route = `R${run}`;
  const lastName = `Bautista${run}`;
  const meter = `SN-E6-${run}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const period = today.slice(0, 7);

  await signIn(page, adminUser, adminPass);
  await createUser(page, clerk.user, "BILLING_CLERK", clerk.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await signOut(page);

  // Clerk: a zone and route of its own, a customer on that route, and a 4-digit meter.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/routes");
  await page.getByLabel("Zone code").fill(zone);
  await page.getByLabel("Zone name").fill(`E2E zone ${run}`);
  await page.getByRole("button", { name: "Add zone" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`E2E zone ${run}`) })).toBeVisible();
  await page.getByLabel("Zone of the new route").selectOption({ label: `${zone} · E2E zone ${run}` });
  await page.getByLabel("Route code").fill(route);
  await page.getByLabel("Route name").fill(`E2E route ${run}`);
  await page.getByRole("button", { name: "Add route" }).click();
  await expect(page.getByText(`${route} · E2E route ${run}`).first()).toBeVisible();

  await page.goto("/water/customers/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Rosa");
  await page.getByLabel("Address").fill("Purok 5, Pipindan, Binangonan, Rizal");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${lastName}, Rosa`) })).toBeVisible();
  await page.getByLabel("Service address").fill("Purok 5, Pipindan");
  await page.getByLabel("Reading route").selectOption({ label: `${route} · E2E route ${run}` });
  await page.getByRole("button", { name: "File application" }).click();
  await expect(page.getByText(/WAPP-\d{4}-\d{5}/).first()).toBeVisible();

  await page.goto("/water/connections");
  await page.getByLabel("Serial no.").fill(meter);
  await page.getByRole("button", { name: "Add meter" }).click();
  await expect(page.getByRole("cell", { name: meter, exact: true })).toBeVisible();
  await signOut(page);

  // Manager approves; teller collects the fees.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/water/applications");
  await page.getByRole("row", { name: new RegExp(lastName) }).getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Approve application" }).click();
  await expect(page.getByText(/Approved: account WA-\d{6}/)).toBeVisible();
  const accountNo = (await page.getByText(/Approved: account WA-\d{6}/).textContent())!.match(/WA-\d{6}/)![0];
  await signOut(page);

  await signIn(page, teller.user, teller.pass);
  await page.goto("/cashiering/teller");
  // A new teller: open today's session first.
  await page.getByLabel("Opening cash").fill("0");
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByText("Session open")).toBeVisible();
  await page.getByLabel("Payor type").selectOption("WATER_CUSTOMER");
  await page.getByLabel("Search payor").fill(lastName);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(lastName) }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("₱4,500.00");
  await page.getByLabel("BIR receipt no.").fill(`W6-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await signOut(page);

  // Clerk installs the meter at 9,990, opens the period and reads 8 with rollover (18 m³, flagged LOWER).
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/water/applications");
  await page.getByRole("row", { name: new RegExp(lastName) }).getByRole("link", { name: "Review" }).click();
  await page.getByLabel("Meter serial no.").fill(meter);
  await page.getByLabel("Initial reading").fill("9990");
  await page.getByRole("button", { name: "Install meter" }).click();
  await expect(page.getByText(/Installed: account WA-\d{6} is ACTIVE/)).toBeVisible();

  await page.goto("/water/readings");
  await page.getByLabel("Zone", { exact: true }).selectOption({ label: `${zone} · E2E zone ${run}` });
  await page.getByLabel("Period (YYYY-MM)").fill(period);
  await page.getByLabel("Reading from").fill(`${period}-01`);
  await page.getByLabel("Reading to").fill(today);
  await page.getByLabel("Bill date").fill(today);
  await page.getByRole("button", { name: "Open period" }).click();
  await page.getByRole("row", { name: new RegExp(zone) }).getByRole("link", { name: "Readings" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${period} · ${zone}`) })).toBeVisible();

  const sheetHref = await page.getByRole("link", { name: `Reading sheet ${route} (PDF)` }).getAttribute("href");
  const sheet = await pdfText(page, sheetHref!);
  expect(sheet).toContain(accountNo);
  expect(sheet).toContain("9,990");

  await page.getByLabel(`Present reading for ${accountNo}`).fill("8");
  await page.getByLabel(`Rollover for ${accountNo}`).check();
  await page.getByRole("button", { name: `Save reading for ${accountNo}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(accountNo) })).toContainText("LOWER");

  await page.getByRole("button", { name: `Approve reading for ${accountNo}` }).click();
  await expect(page.getByRole("row", { name: new RegExp(accountNo) }).first()).toContainText("APPROVED");

  // Billing run: preview, then post.
  await page.goto("/water/billing");
  await page.getByRole("row", { name: new RegExp(zone) }).getByRole("link", { name: "Bill" }).click();
  await expect(page.getByRole("row", { name: new RegExp(accountNo) })).toContainText("₱400.00");
  await page.getByRole("button", { name: "Post billing run" }).click();
  await expect(page.getByText(/Billed: 1 bill/)).toBeVisible();

  const billHref = await page.getByRole("link", { name: `Bill PDF ${accountNo}` }).getAttribute("href");
  const billPdf = await pdfText(page, billHref!);
  expect(billPdf).toContain(accountNo);
  expect(billPdf).toContain("18");
  expect(billPdf).toContain("₱400.00");
});
