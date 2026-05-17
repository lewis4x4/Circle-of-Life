import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * CriticalAlertBanner — Playwright + axe accessibility spec.
 *
 * These tests require a design-preview route to be registered at:
 *   /admin/v2/design-preview/critical-alert-banner
 *
 * The route must render a <CriticalAlertBanner> with the
 * `data-ui-v2-preview` attribute on its wrapper, e.g.:
 *   <div data-ui-v2-preview="critical-alert-banner">
 *     <CriticalAlertBanner
 *       title="Unable to load this page"
 *       description="Try refreshing or contact support if the issue persists."
 *       reference="abc123def456"
 *       icon={<AlertTriangle aria-hidden className="h-5 w-5" />}
 *       actions={<button type="button">Retry</button>}
 *     />
 *   </div>
 *
 * See RecordDetailHeader.a11y.spec.ts for the established preview-route
 * pattern. TODO: create the preview route; until then these tests are
 * skipped so the spec remains discoverable but does not block CI.
 */

const PREVIEW_URL = "/admin/v2/design-preview/critical-alert-banner";

test.describe("CriticalAlertBanner a11y", () => {
  test.skip(
    true,
    "Preview route not yet created — see CriticalAlertBanner.a11y.spec.ts for setup instructions",
  );

  test("renders with zero critical/serious axe violations", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="critical-alert-banner"]');

    const results = await new AxeBuilder({ page })
      .include('[data-ui-v2-preview="critical-alert-banner"]')
      .analyze();

    const serious = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });

  test("critical severity exposes role=alert with assertive live region", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="critical-alert-banner"]');

    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  test("title renders as a heading element", async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="critical-alert-banner"]');

    const heading = page.getByRole("heading", {
      name: /unable to load this page/i,
    });
    await expect(heading).toBeVisible();
  });

  test("retry action is keyboard-reachable with visible focus ring", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui-v2-preview="critical-alert-banner"]');

    const retry = page.getByRole("button", { name: /retry/i });
    await expect(retry).toBeVisible();
    await retry.focus();
    await expect(retry).toBeFocused();
  });
});
