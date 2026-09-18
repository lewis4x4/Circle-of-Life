import { expect, test } from "@playwright/test";

import {
  adminClient,
  facilityId,
  facilityTimezone,
  projectedWindows,
  serviceDateIn,
  signIn,
  skipUnlessEnabled,
} from "./_helpers";

/**
 * The Smart Rounding shell: what renders, how many tabs, and what must never
 * appear. Spec 25A acceptance items 1 (rendered), 3, 10 and 11.
 */
skipUnlessEnabled();

test.describe("Smart Rounding shell", () => {
  test("the windows the cadence version in force defines all render on the board", async ({ page }) => {
    // Acceptance 1, the rendered half. The count is derived, never asserted
    // against a number this file holds: decision D15 records that the spec
    // reports three different resident counts for the same building, so the
    // test prints what it measured and asserts the board and the configuration
    // agree with each other.
    const admin = adminClient();
    const facility = facilityId();
    const zone = await facilityTimezone(admin, facility);
    const windows = await projectedWindows(admin, facility, serviceDateIn(zone));

    await signIn(page, "facility_admin");
    await page.goto("/admin/rounding");

    const header = page.getByRole("region", { name: /cadence in force/i });
    await expect(header).toBeVisible();
    await expect(header).toContainText(`${windows.length} check`);

    for (const window of windows) {
      // The label is the row's, so a renamed window follows automatically.
      await expect(header).toContainText(window.label);
    }
    console.log(`[smart-rounding] cadence in force projects ${windows.length} window(s) for this service date`);
  });

  test("the tab strip has exactly five tabs", async ({ page }) => {
    // Acceptance 11. The nine tab strip grew one tab at a time, so the
    // assertion is on the count and not on the presence of five known labels:
    // a sixth tab added next to the five passes a presence test.
    await signIn(page, "facility_admin");
    await page.goto("/admin/rounding");

    const strip = page.getByRole("navigation", { name: /smart rounding sections/i });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link")).toHaveCount(5);
  });

  test("no surface in the module renders Evening, a migration number, a raw enum value or a resident level number", async ({ page }) => {
    // Acceptance 3 and 10, decisions D3, D4 and D5.
    const routes = [
      "/admin/rounding",
      "/admin/rounding/watchlist",
      "/admin/rounding/monitoring-orders",
      "/admin/rounding/integrity",
      "/admin/rounding/reports",
    ];

    await signIn(page, "facility_admin");

    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("navigation", { name: /smart rounding sections/i })).toBeVisible();
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");

      // "Evening" is dead in this module. The shift_type enum keeps the value
      // for other modules; nothing here writes or renders it, and the 22:00
      // window is keyed late_evening with the label "Late evening check" so a
      // word boundary match is what this asserts.
      expect(body, `${route} renders the retired daypart`).not.toMatch(/\bEvening\b/);

      // A migration number. Three digits on their own, which is why the match
      // requires the word "migration" next to it rather than any three digits:
      // a room number and a resident count are both three digits.
      expect(body, `${route} names a migration`).not.toMatch(/\bmigration\s+\d{3}\b/i);

      // A raw enum value or a table name. These are the ones that leak.
      for (const leak of [
        "shift_change_am",
        "mid_morning",
        "late_evening",
        "completed_on_time",
        "critically_overdue",
        "pending_approval",
        "resident_observation_tasks",
        "facility_cadence_versions",
        "watchlist_signal_instances",
        "monitoring_order_id",
      ]) {
        expect(body, `${route} renders the raw identifier ${leak}`).not.toContain(leak);
      }

      // Retired names, spec section 13.
      for (const retired of ["round_shift_configs", "resident_round_overrides", "round_location_vocab", "round_activity_vocab", "rounds-escalation-engine", "cart_assignments"]) {
        expect(body, `${route} names the retired ${retired}`).not.toContain(retired);
      }

      // No resident level number. Decision D5: no score, no percentage and no
      // index on a resident row. A facility level aggregate is allowed, so the
      // assertion is on the vocabulary that only ever labels a per resident
      // figure.
      for (const scoreWord of ["Safety score", "Risk score", "Risk index", "Acuity score", "Composite score"]) {
        expect(body, `${route} renders ${scoreWord}`).not.toContain(scoreWord);
      }
    }
  });

  test("the Integrity tab loads rather than failing to a generic scope message", async ({ page }) => {
    // Defect 6, decision D23. This tab answered PGRST201 on an ambiguous staff
    // embed and the surface reported it as a facility scope problem, which is
    // how three unrelated query bugs hid behind one error string.
    await signIn(page, "facility_admin");
    await page.goto("/admin/rounding/integrity");
    await expect(page.getByRole("navigation", { name: /smart rounding sections/i })).toBeVisible();
    await expect(page.getByText(/Confirm facility scope and retry/i)).toHaveCount(0);
  });
});
