import { expect, test } from "@playwright/test";
import { businessToday, formatDate } from "../../src/lib/dates";

test("A0.10 /health shows DB: OK and today's Manila date", async ({ page }) => {
  await page.goto("/health");
  await expect(page.getByText("DB: OK")).toBeVisible();
  await expect(page.getByTestId("business-date")).toHaveText(formatDate(businessToday()));
});
