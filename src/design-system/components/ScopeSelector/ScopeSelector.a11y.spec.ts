import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/scope-selector";

test.describe("ScopeSelector a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="scope-selector"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="scope-selector"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("owner/group selects are keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const owner = page
      .getByRole("combobox", { name: /owner/i })
      .first();
    await owner.focus();
    await owner.selectOption({ label: "Circle of Life Holdings" });
    await expect(owner).toHaveValue("col");
  });
});
