import { expect, test } from "@playwright/test";
import { adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

test("A13.10 scan the barcode → quantity 5 → pay ₱500 → the change ₱150.00 is shown", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const mgr = { user: `mgr13_${lc}`, pass: `E2e-Mgr-${run}` };
  const clerk = { user: `clk13_${lc}`, pass: `E2e-Clerk-${run}` };
  const sku = `POS-${run}`;
  const name = `Sardines ${run}`;
  const barcode = `48${Date.now().toString().slice(-11)}`;
  const supplierName = `Supplier13 ${run}`;

  await signIn(page, adminUser, adminPass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, clerk.user, "STORE_CLERK", clerk.pass);
  await signOut(page);

  // Manager: the product, ₱70.00 with a barcode.
  await signIn(page, mgr.user, mgr.pass);
  await page.goto("/store/inventory/new");
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("Barcode (optional)").fill(barcode);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Selling price (₱)").fill("70.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await signOut(page);

  // Store clerk: stock comes in (10 @ ₱55.00), then the POS shift opens.
  await signIn(page, clerk.user, clerk.pass);
  await page.goto("/store/purchasing/suppliers");
  await page.getByLabel("Supplier name").fill(supplierName);
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("cell", { name: supplierName })).toBeVisible();
  await page.goto("/store/purchasing/receiving/new");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: supplierName });
  await page.getByLabel("Product, line 1").selectOption({ label: `${sku} · ${name}` });
  await page.getByLabel("Quantity, line 1").fill("10");
  await page.getByLabel("Unit cost, line 1").fill("55.00");
  await page.getByRole("button", { name: "Post receiving report" }).click();
  await expect(page.getByRole("heading", { name: /Receiving report RR-/ })).toBeVisible();

  await page.goto("/store/pos");
  await page.getByLabel("Opening fund (₱)").fill("1,000.00");
  await page.getByRole("button", { name: "Open shift" }).click();

  // The barcode field has the focus: scan, then set the quantity and take the cash.
  const scan = page.getByLabel("Barcode or SKU");
  await expect(scan).toBeFocused();
  await scan.fill(barcode);
  await scan.press("Enter");
  await expect(page.getByText(name)).toBeVisible();
  await page.getByLabel(`Quantity, ${sku}`).fill("5");
  await expect(page.getByTestId("pos-total")).toHaveText("₱350.00");
  await page.getByLabel("Amount tendered (₱)").fill("500");
  await page.getByRole("button", { name: "Complete sale" }).click();
  await expect(page.getByTestId("pos-change")).toHaveText("₱150.00");
  await expect(page.getByText(/Sale S-\d{4}-\d{6}/)).toBeVisible();
});
