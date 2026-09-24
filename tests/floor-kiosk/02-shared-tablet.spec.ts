import { expect, test } from "@playwright/test";

import { FROZEN, ORIENTATIONS, adminClient, completeReport, demo, pickResident, freezeAt, installFloorDevice, runSeed, skipUnlessEnabled, unlockFloor } from "./_helpers";

/**
 * Spec 40 section 10, item 3: lock, unlock, chart a check, file a fall report,
 * Switch; the second person sees only their own session and the charted check
 * carries the first person's name.
 */
skipUnlessEnabled();

for (const orientation of ORIENTATIONS) {
  test.describe(`shared tablet (${orientation.name})`, () => {
    test.use({ viewport: orientation.viewport });
    test.beforeAll(() => runSeed());

    test("Ashley charts Evelyn's 9:30 check and files a fall; Dana unlocks after Switch and sees only her own session", async ({ page }) => {
      const seed = demo();
      await freezeAt(page, FROZEN.floor);
      await installFloorDevice(page, "HL-FLOOR-02");
      await page.goto("/floor/lock");
      await unlockFloor(page, "ashley");
      await expect(page.getByRole("banner").getByText("Ashley W.")).toBeVisible();

      // Chart the overdue 9:30 check (late reason required when over).
      await page.getByRole("link", { name: /chart safety check for Evelyn Carter/i }).or(page.getByRole("button", { name: /chart safety check for Evelyn Carter/i })).first().click();
      await expect(page).toHaveURL(/\/floor\/check\//);
      await page.getByRole("button", { name: /^awake$/i, pressed: false }).click();
      await page.getByRole("group", { name: /where (is she|are they)/i }).getByRole("button").first().click();
      await page.getByLabel(/why late/i).fill("With another resident");
      await page.getByRole("button", { name: /save check/i }).click();
      await expect(page).toHaveURL(/\/floor$/);

      // File a fall report for Harold.
      await page.getByRole("link", { name: /something happened/i }).or(page.getByRole("button", { name: /something happened/i })).first().click();
      await expect(page).toHaveURL(/\/floor\/report/);
      await pickResident(page, "Harold Nguyen");
      await page.getByRole("button", { name: /^fall/i }).click();
      await completeReport(page);
      await page.getByRole("link", { name: /back to now/i }).or(page.getByRole("button", { name: /back to now/i })).first().click();

      // Switch: back to the lock screen; Dana unlocks.
      await page.getByRole("button", { name: /^switch$/i }).click();
      await expect(page).toHaveURL(/\/floor\/lock/);
      await unlockFloor(page, "dana");
      await expect(page.getByRole("banner").getByText("Dana R.")).toBeVisible();
      await expect(page.getByRole("banner").getByText("Ashley W.")).toHaveCount(0);
      // Only Dana's session: her clock-in (6:52) on the strip, none of Ashley's
      // activity, none of Ashley's witness statements, nothing of Ashley's unsent.
      const strip = page.getByRole("region", { name: /my shift/i }).or(page.getByLabel(/my shift/i)).first();
      await expect(strip).toContainText("6:52");
      await expect(strip).toContainText("Clocked in at the front door");
      await expect(strip).not.toContainText("6:58");
      await expect(strip).not.toContainText("Report:");
      await expect(page.getByRole("link", { name: /answer the witness statement/i }).or(page.getByRole("button", { name: /answer the witness statement/i }))).toHaveCount(0);
      await expect(page.getByText("Witness statement", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("banner").getByRole("status")).toContainText("Synced");

      // Evelyn's page on Dana's session (in-app navigation: a page load is a
      // hidden screen, which locks the tablet by design) shows the check
      // charted by Ashley W. and no longer "Not charted".
      await page.getByRole("link", { name: /Evelyn Carter/ }).first().click();
      await expect(page).toHaveURL(new RegExp(`/floor/residents/${seed.residents.evelyn.id}`));
      await expect(page.getByText(/Not charted/)).toHaveCount(0);
      await expect(page.getByText(/Safety check · Ashley W\./).first()).toBeVisible();

      // The database agrees: the log is Ashley's, the fall is Ashley's.
      const admin = adminClient();
      const logs = await admin
        .from("resident_observation_logs")
        .select("staff_id, late_reason, resident_observation_tasks!resident_observation_logs_task_id_fkey(notes)")
        .eq("facility_id", seed.facilityId)
        .eq("resident_id", seed.residents.evelyn.id)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(logs.error).toBeNull();
      expect(logs.data?.[0]?.staff_id).toBe(seed.people.ashley.staffId);
      const falls = await admin
        .from("care_events")
        .select("reported_by, kind")
        .eq("facility_id", seed.facilityId)
        .eq("resident_id", seed.residents.harold.id)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(falls.error).toBeNull();
      expect(falls.data?.[0]).toMatchObject({ reported_by: seed.people.ashley.userId });
    });
  });
}
