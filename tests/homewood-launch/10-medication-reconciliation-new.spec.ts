import type { Page } from "@playwright/test";

import { test, expect, signIn, adminClient, HOMEWOOD } from "./_helpers";

async function scopeHomewood(page: Page) {
  await page.getByRole("button", { name: /facility filter/i }).first().click();
  await page.getByRole("menuitem", { name: /homewood/i }).first().click();
  await expect(page.getByRole("button", { name: /facility filter/i }).first()).not.toContainText(/all facilities/i, {
    timeout: 15_000,
  });
}

test.describe("Medication reconciliation — new draft entry", () => {
  test("legacy /pipeline/discharge-transition/new resolves to the new draft page", async ({ page }) => {
    await signIn(page, "owner");
    await page.goto("/pipeline/discharge-transition/new");
    await expect(page).toHaveURL(/\/admin\/discharge\/new(?:\?.*)?$/);
    await expect(page.getByRole("heading", { name: /new medication reconciliation/i })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("loads without SQL error text in the drafts panel (empty is OK)", async ({ page }) => {
    await signIn(page, "owner");
    await scopeHomewood(page);

    await page.goto("/admin/discharge/new");
    await expect(page.getByRole("heading", { name: /new medication reconciliation/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("med-rec-drafts-panel")).toBeVisible();

    await expect(page.getByText(/does not exist/i)).toHaveCount(0);
    await expect(page.getByText(/discharge_med_reconciliation/i)).toHaveCount(0);

    await expect(page.getByText(/No in-progress drafts/i)).toBeVisible();
    await expect(page.getByText(/Couldn't load in-progress drafts/i)).toHaveCount(0);
  });

  test("shows generic drafts error with retry when the drafts query is blocked", async ({ page }) => {
    await signIn(page, "owner");
    await scopeHomewood(page);

    await page.route("**/rest/v1/discharge_med_reconciliation*", (route) => route.abort());

    await page.goto("/admin/discharge/new");
    await expect(page.getByText(/Couldn't load in-progress drafts/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("med-rec-drafts-retry")).toBeVisible();

    await page.unroute("**/rest/v1/discharge_med_reconciliation*");
    await page.getByTestId("med-rec-drafts-retry").click();

    await expect(page.getByText(/Couldn't load in-progress drafts/i)).not.toBeVisible({ timeout: 25_000 });
  });

  test("shows compact draft cards when in-progress drafts exist at Homewood", async ({ page }) => {
    const supa = adminClient();
    const { count, error } = await supa
      .from("discharge_med_reconciliation")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .is("deleted_at", null)
      .in("status", ["draft", "pharmacist_review"]);
    if (error) {
      test.skip(true, `discharge_med_reconciliation count failed: ${error.message}`);
    }
    test.skip(!count || count < 1, "Homewood needs ≥1 in-progress discharge med reconciliation for this assertion.");

    await signIn(page, "owner");
    await scopeHomewood(page);
    await page.goto("/admin/discharge/new");
    await expect(page.getByRole("heading", { name: /new medication reconciliation/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("med-rec-draft-card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^resume$/i }).first()).toBeVisible();
  });
});
