// Read-only witness for the disposable local app and synthetic Alpha/Beta fixtures.
// Supply storage state saved after normal local login and selecting Fixture Alpha.
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";

const storageState = process.env.LOCAL_UI_STORAGE_STATE;
if (!storageState) throw new Error("LOCAL_UI_STORAGE_STATE is required");
const output = process.env.LOCAL_UI_PROOF_DIR || "test-results/smart-rounding-full-app";
fs.mkdirSync(output, { recursive: true });
const baseUrl = "http://127.0.0.1:4398";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  for (const suffix of ["", "/watchlist", "/monitoring-orders", "/integrity", "/reports"]) {
    const response = await page.goto(`${baseUrl}/admin/rounding${suffix}`, { timeout: 120_000 });
    expect(response.status()).toBe(200);
    const navigation = page.getByRole("navigation", { name: /smart rounding sections/i });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(5);

    const ready = suffix === "/integrity" || suffix === "/reports"
      ? page.getByText(/expected windows recorded/)
      : suffix === "/watchlist"
        ? page.getByText(/Nobody is on the Watchlist/)
        : suffix === "/monitoring-orders"
          ? page.getByRole("status", { name: "No Monitoring Order in force", exact: true })
          : page.getByText("Synthetic Alpha", { exact: true }).first();
    await expect(ready).toBeVisible({ timeout: 30_000 });

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/could not be loaded|permission denied|could not be built|could not load/i);
    expect(body).not.toContain("Synthetic Beta");
    await page.screenshot({
      path: `${output}/authenticated${suffix.replace("/", "-") || "-board"}.png`,
      fullPage: true,
    });
    console.log("PASS actual route", suffix || "/");
  }

  const denied = await page.request.get(
    `${baseUrl}/api/rounding/compliance?facilityId=a0000000-0000-4000-8000-000000000002&from=2026-09-18&to=2026-09-19`,
  );
  expect(denied.status()).toBe(403);
  console.log("PASS forbidden facility API403");
  expect(pageErrors).toEqual([]);
  console.log("PASS zero page/hydration errors");
} finally {
  await browser.close();
}
