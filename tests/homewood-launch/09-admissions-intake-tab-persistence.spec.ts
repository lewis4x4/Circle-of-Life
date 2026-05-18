import type { Page } from "@playwright/test";

import { test, expect, signIn } from "./_helpers";

async function scopeHomewood(page: Page) {
  await page.getByRole("button", { name: /facility filter/i }).first().click();
  await page.getByRole("menuitem", { name: /homewood/i }).first().click();
  await expect(page.getByRole("button", { name: /facility filter/i }).first()).not.toContainText(/all facilities/i, {
    timeout: 15_000,
  });
}

test.describe("Admission intake (new case form)", () => {
  test("notes and move-in persist when switching Direct admit ↔ Existing inquiry; direct identity resets", async ({ page }) => {
    const marker = `E2E_TAB_PERSIST_${Date.now()}`;

    await signIn(page, "owner");
    await scopeHomewood(page);

    await page.goto("/admin/admissions/new");
    await expect(page.getByRole("heading", { name: /new admission case/i })).toBeVisible({ timeout: 20_000 });

    const inquiryTab = page.getByRole("radio", { name: /existing inquiry\s*\(/i });
    const inquiryLabel = (await inquiryTab.textContent())?.trim() ?? "";
    const m = inquiryLabel.match(/\((\d+)\)/);
    const inquiryCount = m ? Number(m[1]) : 0;
    test.skip(
      inquiryCount < 1,
      "Homewood needs ≥1 inquiry or pending admission resident — otherwise case detail fields unmount on the Existing inquiry tab.",
    );

    await page.getByRole("radio", { name: /^direct admit$/i }).click();

    await page.locator("#dir-fn").fill("Temp");
    await page.locator("#dir-ln").fill("Walker");

    await page.getByTestId("dir-dob-trigger").click();
    await page.locator('[role="grid"]').locator("button:not([disabled])").first().click();

    await page.locator("#dir-gender").click();
    await page.getByRole("option", { name: /^female$/i }).click();

    await page.locator("#dir-case-source").click();
    await page.getByRole("option", { name: /^walk-in$/i }).click();

    await page.locator("#adm-notes").fill(marker);

    await page.getByTestId("adm-target-move-in-trigger").click();
    await page.locator('[role="grid"]').locator("button:not([disabled])").first().click();

    await inquiryTab.click();

    await expect(page.locator("#dir-fn")).toHaveCount(0);
    await expect(page.locator("#dir-ln")).toHaveCount(0);

    await page.getByRole("radio", { name: /^direct admit$/i }).click();

    await expect(page.locator("#adm-notes")).toHaveValue(marker);
    await expect(page.getByTestId("adm-target-move-in-trigger")).not.toContainText("MM / DD / YYYY", {
      timeout: 10_000,
    });
  });
});
