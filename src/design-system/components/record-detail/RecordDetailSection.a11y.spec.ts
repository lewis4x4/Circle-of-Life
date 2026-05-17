import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * RecordDetailSection — Playwright + axe accessibility spec.
 *
 * These tests require a design-preview route to be registered at:
 *   /admin/v2/design-preview/record-detail-section
 *
 * The route must render a <RecordDetailSection> with `data-ui-v2-preview`
 * attribute on its wrapper, e.g.:
 *   <div data-ui-v2-preview="record-detail-section">
 *     <RecordDetailSection
 *       title="Contact information"
 *       description="Primary contact for this resident."
 *       action={<button type="button">Edit</button>}
 *     >
 *       <p>Name: Mary Johnson</p>
 *     </RecordDetailSection>
 *   </div>
 *
 * See ActionQueue.a11y.spec.ts for the established preview-route pattern.
 * TODO: create the preview route; until then these tests are skipped.
 */

const PREVIEW_URL = "/admin/v2/design-preview/record-detail-section";

test.describe("RecordDetailSection a11y", () => {
  test.skip(
    true,
    "Preview route not yet created — see RecordDetailSection.a11y.spec.ts for setup instructions",
  );

  test("renders with zero critical/serious axe violations", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="record-detail-section"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="record-detail-section"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("title renders as h2 heading inside a section landmark", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="record-detail-section"]');

    const h2 = page.getByRole("heading", {
      name: /contact information/i,
      level: 2,
    });
    await expect(h2).toBeVisible();

    // The section element with the h2 is a region landmark
    const region = page.getByRole("region", { name: /contact information/i });
    await expect(region).toBeVisible();
  });

  test("action button is keyboard-reachable", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="record-detail-section"]');

    const editBtn = page.getByRole("button", { name: /edit/i });
    await expect(editBtn).toBeVisible();
  });

  test("section body content is visible", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="record-detail-section"]');

    // Body content should be present inside the region
    const region = page.getByRole("region", { name: /contact information/i });
    await expect(region).toContainText("Mary Johnson");
  });
});
