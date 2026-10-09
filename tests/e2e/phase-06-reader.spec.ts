import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { activeAccountViaUi, adminPass, adminUser, createUser, signIn, signOut } from "./water-setup";

// T6.4: the reading app keeps working without signal and syncs when it returns (Chromium offline
// emulation). Reopening the app with no signal needs a production build (the dev server's runtime
// can't hydrate from the cache), so that test is tagged @prod and runs with `npm run e2e:prod`.
// The exit check on a real phone is done by hand and noted in the Phase 06 summary.

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });

async function readerScenario(page: Page, context: BrowserContext, reopenOffline: boolean) {
  test.setTimeout(240_000);
  const run = Date.now().toString(36).toUpperCase();
  const lc = run.toLowerCase();
  const clerk = { user: `clk6r_${lc}`, pass: `E2e-Clerk-${run}` };
  const mgr = { user: `mgr6r_${lc}`, pass: `E2e-Mgr-${run}` };
  const teller = { user: `tlr6r_${lc}`, pass: `E2e-Teller-${run}` };
  const reader = { user: `rdr6_${lc}`, pass: `E2e-Reader-${run}` };

  await signIn(page, adminUser, adminPass);
  await createUser(page, clerk.user, "BILLING_CLERK", clerk.pass);
  await createUser(page, mgr.user, "MANAGER", mgr.pass);
  await createUser(page, teller.user, "TELLER", teller.pass);
  await createUser(page, reader.user, "METER_READER", reader.pass, `Reader ${run}`);
  await signOut(page);

  const { accountNo, route } = await activeAccountViaUi(page, { run, clerk, mgr, teller, initialReading: 100, readerName: `Reader ${run}` });

  // The reader opens the app with signal (installs the service worker), then loses it.
  await signIn(page, reader.user, reader.pass);
  await page.getByRole("link", { name: /Reading app/ }).first().click();
  await expect(page.getByRole("heading", { name: "Meter reading" })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByText(new RegExp(`${route} ·`))).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByTestId("connection")).toHaveText("Offline");
  await page.getByRole("button", { name: new RegExp(accountNo) }).click();
  for (const d of ["1", "1", "5"]) await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByText("Used 15 m³")).toBeVisible();
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByTestId("queue-count")).toHaveText("1 waiting to sync");

  if (reopenOffline) {
    // Still no signal: the app reopens from the phone's cache with the reading still queued.
    await page.reload();
    await expect(page.getByTestId("connection")).toHaveText("Offline");
    await expect(page.getByTestId("queue-count")).toHaveText("1 waiting to sync");
    await expect(page.getByRole("button", { name: new RegExp(`${accountNo}.*Queued 115`) })).toBeVisible();
  }

  // Signal returns: the queue syncs by itself and the route shows the stored reading.
  await context.setOffline(false);
  await expect(page.getByTestId("queue-count")).toHaveText("Nothing waiting", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: new RegExp(`${accountNo}.*Read 115`) })).toBeVisible();
}

test("reading app: an offline reading is queued on the phone and syncs once online", async ({ page, context }) => {
  await readerScenario(page, context, false);
});

test("reading app @prod: reopens from the cache with no signal, keeps the queue, and syncs once online", async ({ page, context }) => {
  await readerScenario(page, context, true);
});
