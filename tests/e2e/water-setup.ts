import { expect, type Page } from "@playwright/test";

export const adminUser = process.env.SEED_ADMIN_USERNAME ?? "admin";
export const adminPass = process.env.SEED_ADMIN_PASSWORD ?? "";

export async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

export async function createUser(page: Page, username: string, role: string, password: string, fullName = `E2E ${role}`) {
  await page.goto("/admin/users");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Role").selectOption(role);
  await page.getByLabel("Initial password").fill(password);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();
}

export type Login = { user: string; pass: string };

/**
 * Through the UI: a fresh zone and route, one ACTIVE account on it (customer → application →
 * approval → fees at the teller → meter installed at `initialReading`), and the zone's billing
 * period for this month. Signs out at the end. Returns the account no. and the period label.
 */
export async function activeAccountViaUi(
  page: Page,
  o: { run: string; clerk: Login; mgr: Login; teller: Login; initialReading: number; readerName?: string },
): Promise<{ accountNo: string; zone: string; route: string; lastName: string; period: string }> {
  const { run } = o;
  const zone = `Z${run}`;
  const route = `R${run}`;
  const lastName = `Reyes${run}`;
  const meter = `SN-R-${run}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const period = today.slice(0, 7);

  await signIn(page, o.clerk.user, o.clerk.pass);
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
  if (o.readerName) {
    await page.getByLabel(`Meter reader for ${route}`).selectOption({ label: o.readerName });
    await expect(page.getByLabel(`Meter reader for ${route}`)).toHaveValue(/.+/);
  }

  await page.goto("/water/customers/new");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("First name").fill("Ana");
  await page.getByLabel("Address").fill("Purok 6, Pipindan, Binangonan, Rizal");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${lastName}, Ana`) })).toBeVisible();
  await page.getByLabel("Service address").fill("Purok 6, Pipindan");
  await page.getByLabel("Reading route").selectOption({ label: `${route} · E2E route ${run}` });
  await page.getByRole("button", { name: "File application" }).click();
  await expect(page.getByText(/WAPP-\d{4}-\d{5}/).first()).toBeVisible();

  await page.goto("/water/connections");
  await page.getByLabel("Serial no.").fill(meter);
  await page.getByRole("button", { name: "Add meter" }).click();
  await expect(page.getByRole("cell", { name: meter, exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, o.mgr.user, o.mgr.pass);
  await page.goto("/water/applications");
  await page.getByRole("row", { name: new RegExp(lastName) }).getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Approve application" }).click();
  await expect(page.getByText(/Approved: account WA-\d{6}/)).toBeVisible();
  const accountNo = (await page.getByText(/Approved: account WA-\d{6}/).textContent())!.match(/WA-\d{6}/)![0];
  await signOut(page);

  await signIn(page, o.teller.user, o.teller.pass);
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
  await page.getByLabel("BIR receipt no.").fill(`WR-${run}`);
  await page.getByRole("button", { name: "Issue receipt" }).click();
  await expect(page.getByRole("heading", { name: /Acknowledgement receipt AR-/ })).toBeVisible();
  await signOut(page);

  await signIn(page, o.clerk.user, o.clerk.pass);
  await page.goto("/water/applications");
  await page.getByRole("row", { name: new RegExp(lastName) }).getByRole("link", { name: "Review" }).click();
  await page.getByLabel("Meter serial no.").fill(meter);
  await page.getByLabel("Initial reading").fill(String(o.initialReading));
  await page.getByRole("button", { name: "Install meter" }).click();
  await expect(page.getByText(/Installed: account WA-\d{6} is ACTIVE/)).toBeVisible();

  await page.goto("/water/readings");
  await page.getByLabel("Zone", { exact: true }).selectOption({ label: `${zone} · E2E zone ${run}` });
  await page.getByLabel("Period (YYYY-MM)").fill(period);
  await page.getByLabel("Reading from").fill(`${period}-01`);
  await page.getByLabel("Reading to").fill(today);
  await page.getByLabel("Bill date").fill(today);
  await page.getByRole("button", { name: "Open period" }).click();
  await expect(page.getByRole("row", { name: new RegExp(zone) })).toBeVisible();
  await signOut(page);
  return { accountNo, zone, route, lastName, period };
}
