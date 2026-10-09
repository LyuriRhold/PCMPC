import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

const PORT = 3000;
// E2E_SERVER=prod (npm run e2e:prod) runs the @prod tests against a production build instead of the dev server.
const prod = process.env.E2E_SERVER === "prod";
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  // One worker: specs share the dev database and one dev server that compiles routes on first use.
  workers: 1,
  // The dev server compiles each route on first use (Better Auth alone takes several seconds cold).
  expect: { timeout: 15_000 },
  // Multi-step flows (sign in as two users, several first-time compiles) need more than the 30 s default.
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  // @prod tests need a production build (offline reading app); the dev-server run leaves them out.
  grepInvert: prod ? undefined : /@prod/,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    timezoneId: "Asia/Manila",
    locale: "en-PH",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: prod ? "npm run build && npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI && !prod,
    timeout: prod ? 600_000 : 180_000,
  },
});
