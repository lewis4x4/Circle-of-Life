import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/copilot-button";

test.describe("CopilotButton a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="copilot-button"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="copilot-button"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("Copilot button opens a dialog via keyboard", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    const btn = page.getByRole("button", { name: /^copilot/i }).first();
    await btn.focus();
    await btn.press("Enter");
    await expect(page.getByRole("dialog", { name: /copilot/i })).toBeVisible();
  });
});
