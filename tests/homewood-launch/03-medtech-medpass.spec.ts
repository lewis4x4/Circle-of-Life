import { test, expect, signIn, requireHomewoodResidents, cleanupTestRows, TEST_MARKER, adminClient, HOMEWOOD } from "./_helpers";

/**
 * Workflow 3 — Med-tech opens med pass → marks one med as given, one as
 * refused → submission persists.
 *
 * Mutates: inserts up to two `emar_records` rows with TEST_MARKER in
 * `notes`. Cleans up after itself.
 */
test.describe("Homewood — Med-tech med pass", () => {
  test.afterEach(async () => {
    await cleanupTestRows("emar_records", "notes");
  });

  test("med-tech marks one med given + one refused", async ({ page }) => {
    await requireHomewoodResidents(1);

    const supa = adminClient();
    const { count: medCount } = await supa
      .from("resident_medications")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .eq("status", "active")
      .is("deleted_at", null);
    test.skip((medCount ?? 0) < 2, `Homewood has ${medCount ?? 0} active medications — needs ≥2 for the med-pass workflow.`);

    await signIn(page, "med_tech");
    await expect(page).toHaveURL(/\/med-tech/);

    // Open the med-pass queue
    const queue = page.getByRole("link", { name: /med pass|due now|scheduled/i }).first();
    if (await queue.isVisible().catch(() => false)) await queue.click();

    // Mark first as given
    const giveBtn = page.getByRole("button", { name: /given|administer/i }).first();
    await expect(giveBtn).toBeVisible();
    await giveBtn.click();
    await page.getByLabel(/notes|comments/i).fill(`Given — ${TEST_MARKER}`);
    await page.getByRole("button", { name: /confirm|save/i }).click();
    await expect(page.getByText(/recorded|saved|administered/i)).toBeVisible({ timeout: 10_000 });

    // Mark second as refused
    const refuseBtn = page.getByRole("button", { name: /refused/i }).first();
    await expect(refuseBtn).toBeVisible();
    await refuseBtn.click();
    await page.getByLabel(/notes|comments|reason/i).fill(`Refused — ${TEST_MARKER}`);
    await page.getByRole("button", { name: /confirm|save/i }).click();
    await expect(page.getByText(/recorded|saved|refused/i)).toBeVisible({ timeout: 10_000 });

    // DB confirmation
    const { count } = await supa
      .from("emar_records")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .like("notes", `%${TEST_MARKER}%`);
    expect(count ?? 0).toBeGreaterThanOrEqual(2);
  });
});
