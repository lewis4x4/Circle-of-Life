import { test, expect, signIn, requireHomewoodResidents, adminClient, HOMEWOOD, TEST_MARKER } from "./_helpers";

/**
 * Workflow 5 — Management opens a specific resident → updates one care
 * plan field → saves → version history shows the update.
 *
 * Mutates: updates `care_plans.notes` for one row at Homewood. Saves the
 * prior value in a try/finally block and restores it on teardown.
 */
test.describe("Homewood — Management updates care plan", () => {
  test("facility_admin edits care plan and sees version-history bump", async ({ page }) => {
    await requireHomewoodResidents(1);

    const supa = adminClient();
    const { data: plans } = await supa
      .from("care_plans")
      .select("id, version, notes, resident_id")
      .eq("facility_id", HOMEWOOD.facilityId)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(1);
    const plan = plans?.[0];
    test.skip(!plan, "No active care plans at Homewood to edit.");

    const priorNotes = plan!.notes;
    const priorVersion = plan!.version;

    try {
      await signIn(page, "facility_admin");
      await page.goto(`/admin/residents/${plan!.resident_id}/care-plan`);

      await page.getByLabel(/notes/i).fill(`Care-plan edit ${TEST_MARKER} ${Date.now()}`);
      await page.getByRole("button", { name: /save|update/i }).click();
      await expect(page.getByText(/saved|updated|version/i)).toBeVisible({ timeout: 10_000 });

      // Version-history bump
      const { data: refreshed } = await supa
        .from("care_plans")
        .select("version")
        .eq("id", plan!.id)
        .single();
      expect(refreshed?.version ?? priorVersion).toBeGreaterThan(priorVersion);
    } finally {
      // Restore prior state — restore notes string and decrement version field
      await supa
        .from("care_plans")
        .update({ notes: priorNotes, version: priorVersion })
        .eq("id", plan!.id);
    }
  });
});
