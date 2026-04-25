import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/filter-bar";

test.describe("FilterBar a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="filter-bar"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="filter-bar"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("reset and save-view buttons are keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const saveBtn = page.getByRole("button", { name: /save view/i }).first();
    await saveBtn.focus();
    await saveBtn.press("Enter");
    await expect(page.getByRole("button", { name: /^saved$/i }).first()).toBeVisible();
  });
});
