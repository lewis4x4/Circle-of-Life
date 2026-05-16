import { test, expect, signIn, requireHomewoodResidents, cleanupTestRows, TEST_MARKER, adminClient, HOMEWOOD } from "./_helpers";

/**
 * Workflow 1 — Caregiver opens shift → sees their resident assignments →
 * completes one ADL documentation entry → saves.
 *
 * Mutates: inserts one row in `adl_logs` with TEST_MARKER in `notes`.
 * Cleans up after itself.
 */
test.describe("Homewood — Caregiver shift + ADL entry", () => {
  test.afterEach(async () => {
    await cleanupTestRows("adl_logs", "notes");
  });

  test("caregiver completes one ADL entry on shift", async ({ page }) => {
    const residents = await requireHomewoodResidents(1);

    await signIn(page, "caregiver");
    await expect(page).toHaveURL(/\/caregiver/);

    // Resident assignments visible on the caregiver hub
    await expect(page.getByRole("heading", { name: /my residents|assigned residents|today/i })).toBeVisible({ timeout: 15_000 });

    // Pick the first resident card / link
    const firstResidentLink = page.locator('a[href*="/caregiver/residents/"], [data-testid="resident-card"] a').first();
    await expect(firstResidentLink).toBeVisible();
    await firstResidentLink.click();

    // Open the ADL form (best-effort selector — fall back to any "ADL" button)
    const adlTrigger = page.getByRole("button", { name: /adl|document care|log adl/i }).first();
    await expect(adlTrigger).toBeVisible();
    await adlTrigger.click();

    // Fill an arbitrary checkbox/radio (the first one) and add the test marker in notes
    const firstOption = page.locator('input[type="checkbox"], input[type="radio"]').first();
    await firstOption.check().catch(() => undefined);
    await page.getByLabel(/notes/i).fill(`Workflow test entry — ${TEST_MARKER}`);
    await page.getByRole("button", { name: /save|submit/i }).click();

    // Confirm save via toast / success indicator
    await expect(page.getByText(/saved|recorded|complete/i)).toBeVisible({ timeout: 10_000 });

    // Verify persistence in DB
    const supa = adminClient();
    const { count } = await supa
      .from("adl_logs")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .like("notes", `%${TEST_MARKER}%`);
    expect(count ?? 0).toBeGreaterThan(0);
    expect(residents).toBeGreaterThan(0);
  });
});
