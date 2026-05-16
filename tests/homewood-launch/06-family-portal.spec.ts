import { test, expect, signIn, adminClient, HOMEWOOD, HOMEWOOD_ACCOUNTS } from "./_helpers";

/**
 * Workflow 6 — Family logs in → sees their loved one's profile → sees
 * most recent activity entry.
 *
 * Read-only — no cleanup needed.
 */
test.describe("Homewood — Family portal", () => {
  test("family member sees resident profile and recent activity", async ({ page }) => {
    const supa = adminClient();

    // Confirm the family canonical account has at least one active link
    const { data: linkUser } = await supa.auth.admin.listUsers({ perPage: 1000 });
    const family = linkUser?.users.find((u) => u.email === HOMEWOOD_ACCOUNTS.family);
    test.skip(!family, "Canonical family account missing in auth.users.");

    const { data: links } = await supa
      .from("family_resident_links")
      .select("resident_id")
      .eq("user_id", family!.id)
      .is("revoked_at", null);
    test.skip(!links || links.length === 0, `Family account ${HOMEWOOD_ACCOUNTS.family} has no active resident links.`);

    await signIn(page, "family");
    await expect(page).toHaveURL(/\/family/);

    // The portal should display the linked resident's name or photo
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

    // Most-recent activity entry — best-effort selector
    const activity = page.getByText(/recent activity|today|this week|update/i).first();
    await expect(activity).toBeVisible({ timeout: 15_000 });

    // Sanity: family route must not 4xx
    const response = await page.goto("/family");
    expect(response?.status() ?? 0).toBeLessThan(400);
  });
});
