import { test, expect, signIn, adminClient, HOMEWOOD, TEST_MARKER } from "./_helpers";

/**
 * COL-593 acceptance shape — the administrator clears the Tuesday generator
 * row on Home in three taps or fewer, with no training slides:
 *
 *   1. open /admin (Home)      2. tap "It ran"      (3. nothing else)
 *
 * The row is the one the scheduler writes from the Homewood generator template
 * (migration 459). When no open generator row exists for today the spec skips
 * with a clear message rather than manufacturing one in production: the
 * scheduler owns generation, and a spec-seeded row would carry a synthetic
 * completion into the audit log.
 *
 * Also asserts the W1 rail contract: Home, Weekly Stand Up, Reports hub,
 * My facility, Billing & AR — no Executive, no Med-Tech cockpit.
 */
test.describe("Homewood — Facility Operator Home", () => {
  test("administrator sees the greeting, the operator rail, and clears the generator row in ≤3 taps", async ({ page }) => {
    const supa = adminClient();
    const { data: facility } = await supa.from("facilities").select("timezone").eq("id", HOMEWOOD.facilityId).maybeSingle();
    const timeZone = (facility as { timezone?: string } | null)?.timezone ?? "America/New_York";
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    await signIn(page, "facility_admin");
    await page.goto("/admin");

    await expect(page.getByTestId("facility-operator-home")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Hello(, [^.]+)?\.$/);
    await expect(page.getByText(/Command center/i)).toHaveCount(0);

    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(rail.getByRole("link", { name: "Weekly Stand Up" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "My facility" })).toHaveAttribute("href", `/admin/facilities/${HOMEWOOD.facilityId}`);
    await expect(rail.getByRole("link", { name: "Executive" })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: "Med-Tech cockpit" })).toHaveCount(0);

    const { data: openRows } = await supa
      .from("operation_task_instances")
      .select("id, assigned_shift, status")
      .eq("facility_id", HOMEWOOD.facilityId)
      .eq("template_id", "00000000-0000-0000-0007-000000000302")
      .eq("assigned_shift_date", localDate)
      .in("status", ["pending", "in_progress"])
      .is("deleted_at", null);
    const row = (openRows ?? [])[0] as { id: string } | undefined;
    test.skip(!row, `No open generator row for ${localDate} at Homewood — the scheduler writes it for the asset's weekday; nothing to clear today.`);
    if (!row) return;

    const generator = page.getByTestId(`on-tap-row-oti:${row.id}`);
    await expect(generator).toBeVisible();
    await expect(generator.getByRole("button", { name: "It ran" })).toBeVisible();
    await expect(generator.getByRole("button", { name: "Did not run" })).toBeVisible();

    // Tap 2 of 3: the clearance action is on the row.
    await generator.getByRole("button", { name: "It ran" }).click();
    await expect(generator).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByLabel("Cleared today")).toContainText("Generator weekly run");

    const { data: cleared } = await supa
      .from("operation_task_instances")
      .select("status, completed_at, completion_notes")
      .eq("id", row.id)
      .maybeSingle();
    const done = cleared as { status: string; completed_at: string | null; completion_notes: string | null } | null;
    expect(done?.status).toBe("completed");
    expect(done?.completed_at).toBeTruthy();
    expect(done?.completion_notes ?? "").toContain("Outcome: ran");
    // Leave the receipt in place: it is a real completion by the account that
    // signed in, not test residue. TEST_MARKER is not written here on purpose.
    void TEST_MARKER;
  });
});
