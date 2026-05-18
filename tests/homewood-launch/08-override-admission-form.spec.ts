import type { Page } from "@playwright/test";

import { test, expect, signIn } from "./_helpers";

async function scopeHomewood(page: Page) {
  await page.getByRole("button", { name: /facility filter/i }).first().click();
  await page.getByRole("menuitem", { name: /homewood/i }).first().click();
  await expect(page.getByRole("button", { name: /facility filter/i }).first()).not.toContainText(/all facilities/i, {
    timeout: 15_000,
  });
}

/**
 * Administrative override intake — compliance-sensitive bypass path.
 */
test.describe("Override admission (admin / clinical)", () => {
  test("admin route shows header and blocks preview until validation passes", async ({ page }) => {
    await signIn(page, "owner");
    await scopeHomewood(page);

    await page.goto("/admin/residents/new");
    await expect(page.getByRole("heading", { name: /override admission/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("note")).toContainText(/bypasses standard intake/i);

    await page.getByRole("button", { name: /create resident \(override\)/i }).click();
    await expect(page.getByText("Required.").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("clinical alias renders the same override form", async ({ page }) => {
    await signIn(page, "owner");
    await scopeHomewood(page);

    await page.goto("/clinical/residents/add");
    await expect(page.getByRole("heading", { name: /override admission/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
