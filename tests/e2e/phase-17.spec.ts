import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { adminPass, adminUser, signIn } from "./water-setup";

/**
 * E2E runs against the shared dev database, where posting opening balances is a one-time,
 * irreversible step; so this flow stops short of posting (the acceptance tests post) and rolls
 * back every batch it creates.
 */

const CUTOFF = "2026-09-30";

async function rollBackAll(page: Page) {
  page.on("dialog", (d) => void d.accept());
  for (let i = 0; i < 20; i++) {
    const button = page.getByRole("button", { name: /^Roll back/ }).first();
    if (!(await button.isVisible().catch(() => false))) return;
    await button.click();
    await expect(page.getByText(/rolled back/i).first()).toBeVisible();
  }
}

/** The server's members template with `rows` (cells in the template's column order) under the headers. */
async function membersFile(page: Page, rows: Array<Array<string | number>>): Promise<Buffer> {
  const res = await page.request.get("/api/migration/templates/members");
  expect(res.ok()).toBe(true);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(await res.body()).buffer);
  const ws = wb.getWorksheet("Members");
  if (!ws) throw new Error("no Members sheet");
  rows.forEach((r, i) => r.forEach((v, c) => (ws.getCell(i + 2, c + 1).value = v === "" ? null : v)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadFile(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel("Records").selectOption("members");
  await page.getByLabel("Cut-off date").fill(CUTOFF);
  await page.getByLabel("Excel file").setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByRole("button", { name: "Upload and check" }).click();
}

test("the administrator downloads a template, dry-runs a file with an error, stages a clean file, sees the reconciliation and rolls back", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36).toUpperCase();
  await signIn(page, adminUser, adminPass);
  await page.goto("/admin/migration");
  await expect(page.getByRole("heading", { name: "Data migration" })).toBeVisible();

  if (await page.getByText("Opening balances posted").isVisible()) {
    // This database already went live through a migration: the page shows what was posted.
    await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();
    return;
  }
  await rollBackAll(page);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Members template" }).click();
  expect((await download).suggestedFilename()).toBe("migration-members.xlsx");

  // Member no. | Type | Status | Last | First | Middle | Suffix | Birthdate | Sex | Civil status | Street | Purok | Barangay | Municipality | Province | Mobile | Email | Occupation | TIN | Membership date | PMES | BOD res. | Fee
  const row = (no: string, first: string, birthdate: string) => [no, "REGULAR", "ACTIVE", `E2e${run}`, first, "", "", birthdate, "FEMALE", "SINGLE", "", "Mariwasa", "Pipindan", "Binangonan", "Rizal", "", "", "", "", "2020-01-15", "", "", 500];

  await uploadFile(page, `members-${run}-bad.xlsx`, await membersFile(page, [row(`X${run}-1`, "Ana", "1990-02-30")]));
  await expect(page.getByText("1 error").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Not a valid date (use YYYY-MM-DD)" })).toBeVisible();
  await rollBackAll(page);

  await uploadFile(page, `members-${run}.xlsx`, await membersFile(page, [row(`X${run}-1`, "Ana", "1990-02-03"), row(`X${run}-2`, "Bea", "1991-04-05")]));
  await expect(page.getByText("No errors").first()).toBeVisible();
  await page.getByRole("button", { name: /^Stage/ }).first().click();
  await expect(page.getByText("Staged", { exact: true }).first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();
  await expect(page.getByText("Stage the trial balance as of the cut-off")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post opening balances" })).toBeDisabled();

  await rollBackAll(page);
  await expect(page.getByText("Staged", { exact: true })).toHaveCount(0);
});
