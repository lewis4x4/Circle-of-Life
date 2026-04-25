import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/data-table";

test.describe("DataTable a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="data-table"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="data-table"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("Customize and Export buttons are keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const customize = page.getByRole("button", { name: /^customize$/i }).first();
    await customize.focus();
    await customize.press("Enter");
    await expect(page.getByRole("dialog", { name: /customize columns/i }).first()).toBeVisible();

    const exportBtn = page.getByRole("button", { name: /^export$/i }).first();
    await exportBtn.focus();
    await exportBtn.press("Enter");
    await expect(page.getByRole("menu", { name: /export format/i }).first()).toBeVisible();
  });
});
