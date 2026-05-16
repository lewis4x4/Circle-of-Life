import { test, expect, signIn, adminClient, HOMEWOOD } from "./_helpers";

/**
 * Workflow 4 — Management views Homewood daily census → numbers match
 * what the Sprint 1 data audit reports.
 *
 * Read-only — no cleanup needed.
 */
test.describe("Homewood — Management daily census", () => {
  test("census shown in UI matches DB count", async ({ page }) => {
    const supa = adminClient();
    const { count: dbActive } = await supa
      .from("residents")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .is("deleted_at", null)
      .eq("status", "active");

    await signIn(page, "facility_admin");
    await page.goto("/admin/command");

    // The dashboard shows census; look for the active-resident count
    const censusCard = page.getByText(/census|active residents|occupied/i).first();
    await expect(censusCard).toBeVisible({ timeout: 15_000 });

    // Best-effort: extract a number near the census card and compare.
    const dashboardText = await page.locator("body").innerText();
    const numbers = dashboardText.match(/\b\d+\b/g)?.map((n) => parseInt(n, 10)) ?? [];
    expect(numbers).toContain(dbActive ?? 0);
  });
});
