import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/top-bar";

test.describe("TopBar a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="top-bar"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="top-bar"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("Copilot button is keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    const copilot = page.getByRole("button", { name: /copilot/i }).first();
    await copilot.focus();
    await copilot.press("Enter");
    await expect(copilot).toHaveAttribute("aria-expanded", "true");
  });
});
