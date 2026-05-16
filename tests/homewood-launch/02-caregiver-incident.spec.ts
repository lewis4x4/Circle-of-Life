import { test, expect, signIn, requireHomewoodResidents, cleanupTestRows, TEST_MARKER, adminClient, HOMEWOOD } from "./_helpers";

/**
 * Workflow 2 — Caregiver reports a minor incident → form submits →
 * incident appears in management queue.
 *
 * Mutates: inserts one row in `incidents` with TEST_MARKER in `description`.
 * Cleans up after itself.
 */
test.describe("Homewood — Caregiver reports an incident", () => {
  test.afterEach(async () => {
    await cleanupTestRows("incidents", "description");
  });

  test("caregiver submits incident and it appears in management queue", async ({ page, browser }) => {
    await requireHomewoodResidents(1);

    await signIn(page, "caregiver");

    // Navigate to incident report
    const incidentLink = page.getByRole("link", { name: /report incident|new incident|incident report/i }).first();
    await expect(incidentLink).toBeVisible();
    await incidentLink.click();

    // Minimal incident form
    await page.getByLabel(/category|incident type/i).selectOption({ index: 1 }).catch(() => undefined);
    await page.getByLabel(/description/i).fill(`Minor incident — ${TEST_MARKER}`);
    await page.getByLabel(/immediate actions|action taken/i).fill("Notified nurse; resident reassured.");
    await page.getByRole("button", { name: /submit|save/i }).click();
    await expect(page.getByText(/submitted|recorded|created/i)).toBeVisible({ timeout: 10_000 });

    // Verify DB row
    const supa = adminClient();
    const { count } = await supa
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", HOMEWOOD.facilityId)
      .like("description", `%${TEST_MARKER}%`);
    expect(count ?? 0).toBeGreaterThan(0);

    // Sign in as facility_admin in a new browser context and verify visibility
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signIn(adminPage, "facility_admin");
    await adminPage.goto("/admin/incidents");
    await expect(adminPage.getByText(new RegExp(TEST_MARKER, "i"))).toBeVisible({ timeout: 15_000 });
    await adminCtx.close();
  });
});
