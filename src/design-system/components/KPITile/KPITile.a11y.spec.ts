import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/kpi-tile";

test.describe("KPITile a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="kpi-tile"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="kpi-tile"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("info tooltip is keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const infoBtn = page.getByRole("button", { name: /info for occupancy/i }).first();
    await infoBtn.focus();
    await infoBtn.press("Enter");
    await expect(infoBtn).toHaveAttribute("aria-expanded", "true");
  });
});
