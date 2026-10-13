import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("A12.8 create product → PO → receive → the stock card shows qty and average cost", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr12_${lc}`, pass: `E2e-Mgr-${run}` };
  const clerk = { user: `clk12_${lc}`, pass: `E2e-Clerk-${run}` };
  const sku = `E2E-${run}`;
  const name = `Rice 25kg ${run}`;
  const supplierName = `Supplier ${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, clerk.user, "STORE_CLERK", clerk.pass);
  await signOut(page);

  // Manager: the product, with its selling price.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/store/inventory/new");
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Unit").fill("sack");
  await page.getByLabel("Selling price (₱)").fill("1,350.00");
  await page.getByLabel("Reorder level").fill("5");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const productUrl = page.url().split("?")[0]!;
  await signOut(page);

  // Store clerk: the supplier and a purchase order.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/store/purchasing/suppliers");
  await page.getByLabel("Supplier name").fill(supplierName);
  await page.getByLabel("Terms (days)").fill("30");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("cell", { name: supplierName })).toBeVisible();

  await page.goto("/store/purchasing/orders/new");
  await page.getByLabel("Supplier").selectOption({ label: supplierName });
  await page.getByLabel("Product, line 1").selectOption({ label: `${sku} · ${name}` });
  await page.getByLabel("Quantity, line 1").fill("10");
  await page.getByLabel("Unit cost, line 1").fill("1,200.00");
  await page.getByRole("button", { name: "Save purchase order" }).click();
  await expect(page.getByRole("heading", { name: /Purchase order PO-\d{4}-\d{5}/ })).toBeVisible();
  await expect(page.getByTestId("po-status")).toHaveText("DRAFT");
  const poUrl = page.url().split("?")[0]!;
  await signOut(page);

  // Manager: approves the PO.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto(poUrl);
  await page.getByRole("button", { name: "Approve purchase order" }).click();
  await expect(page.getByTestId("po-status")).toHaveText("APPROVED");
  await signOut(page);

  // Store clerk: receives the delivery against the PO (on account).
  await signIn(page, clerk.user, clerk.pass);
  await page.goto(poUrl);
  await page.getByRole("link", { name: "Receive delivery" }).click();
  await page.getByLabel("Supplier invoice no.").fill(`SI-${run}`);
  await page.getByRole("button", { name: "Post receiving report" }).click();
  await expect(page.getByRole("heading", { name: /Receiving report RR-\d{4}-\d{5}/ })).toBeVisible();
  await expect(page.getByText("₱12,000.00").first()).toBeVisible();

  // The stock card: 10 sacks at ₱1,200.0000.
  await page.goto(productUrl);
  await expect(page.getByTestId("stock-qty")).toHaveText("10");
  await expect(page.getByTestId("stock-avg")).toHaveText("₱1,200.0000");
  await expect(page.getByTestId("stock-value")).toHaveText("₱12,000.00");
});
