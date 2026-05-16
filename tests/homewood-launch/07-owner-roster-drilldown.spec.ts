import { test, expect, signIn, requireHomewoodResidents } from "./_helpers";

/**
 * Workflow 7 — Owner views Homewood facility → can drill into resident
 * roster → can drill into a specific resident.
 *
 * Read-only — no cleanup needed.
 */
test.describe("Homewood — Owner roster drilldown", () => {
  test("owner navigates org → Homewood → roster → resident detail", async ({ page }) => {
    await requireHomewoodResidents(1);

    await signIn(page, "owner");
    await expect(page).toHaveURL(/\/admin/);

    // Switch facility scope to Homewood (owner has org-wide access)
    const facilitySwitcher = page.getByRole("button", { name: /facility|all facilities/i }).first();
    if (await facilitySwitcher.isVisible().catch(() => false)) {
      await facilitySwitcher.click();
      await page.getByText(/homewood/i).first().click();
    }

    // Roster page
    await page.goto("/admin/residents");
    await expect(page.getByRole("heading", { name: /residents|roster/i })).toBeVisible({ timeout: 15_000 });

    // Drill into first resident card
    const firstResidentRow = page.locator('a[href*="/admin/residents/"]').first();
    await expect(firstResidentRow).toBeVisible();
    await firstResidentRow.click();

    // Resident detail page renders
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toMatch(/\/admin\/residents\/[0-9a-f-]+/i);
  });
});
