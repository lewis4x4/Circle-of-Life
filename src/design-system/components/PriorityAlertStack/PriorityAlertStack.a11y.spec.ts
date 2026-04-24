import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PREVIEW_URL = "/admin/v2/design-preview/priority-alert-stack";

test.describe("PriorityAlertStack a11y", () => {
  test("renders with zero critical/serious axe violations", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="priority-alert-stack"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="priority-alert-stack"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("ACK button is keyboard operable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    const ack = page.getByRole("button", { name: /acknowledge alert/i }).first();
    await ack.focus();
    await expect(ack).toBeFocused();
  });
});
