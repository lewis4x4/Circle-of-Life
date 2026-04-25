import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/severity-chip";

test.describe("SeverityChip a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="severity-chip"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="severity-chip"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });
});
