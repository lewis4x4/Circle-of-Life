import { expect, test } from "@playwright/test";

import { adminClient, facilityId, roleClient, skipUnlessEnabled } from "./_helpers";

/**
 * Spec 25A acceptance items 5 and 6: a Monitoring Order takes effect the
 * moment it saves.
 *
 * Decision 5 removed the approval queue that the deployed Watches tab had, so
 * the assertions are about the absence of a waiting state as much as about the
 * presence of an active one: the order is `active` on read back, its own checks
 * exist immediately, and the status domain has no value an order could sit in
 * while somebody decides about it.
 *
 * The interval comes from `public.monitoring_order_interval_options`, which is
 * a row set. This file names no interval and no grace value; the spacing
 * assertion is derived from the order's own `interval_minutes` and the grace
 * from `public.monitoring_order_grace_minutes`.
 */
skipUnlessEnabled();

test.describe("Monitoring Orders", () => {
  test("a Resident Aide's order is active immediately and generates its own checks", async () => {
    const admin = adminClient();
    const facility = facilityId();
    const caregiver = await roleClient("caregiver");

    const profile = await admin.from("user_profiles").select("app_role").eq("id", caregiver.userId).maybeSingle();
    expect(
      profile.data?.app_role,
      "the caregiver account in SMART_ROUNDING_E2E_ACCOUNTS does not hold the Resident Aide role, which is the whole point of acceptance 6",
    ).toBe("caregiver");

    const resident = await caregiver.client
      .from("residents")
      .select("id")
      .eq("facility_id", facility)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!resident.data) throw new Error(`no active resident the caregiver can reach at facility ${facility}`);

    const options = await caregiver.client.rpc("monitoring_order_interval_options");
    if (options.error) throw new Error(`monitoring_order_interval_options failed: ${options.error.message}`);
    const interval = (options.data as { interval_minutes?: number }[] | null)?.[0]?.interval_minutes ?? null;
    expect(interval, "the interval presets are rows and there is none to use").not.toBeNull();

    const oneDayMs = 24 * 60 * 60 * 1000;
    const created = await caregiver.client.rpc("create_monitoring_order", {
      p_resident_id: resident.data.id,
      p_interval_minutes: interval,
      p_ordered_by_type: "facility_nurse",
      p_ordered_by_name: "Acceptance run, spec 25A item 6",
      p_order_received_as: "verbal",
      p_reason_category: "change_in_condition",
      p_reason_note: "Playwright acceptance run. Cancel on sight.",
      p_review_due_at: new Date(Date.now() + oneDayMs).toISOString(),
    });
    expect(created.error, created.error ? `a Resident Aide was refused: ${created.error.message}` : undefined).toBeNull();
    const orderId = created.data as string;
    expect(orderId).toBeTruthy();

    try {
      const readBack = await caregiver.client
        .from("resident_monitoring_orders")
        .select("status, entered_by, starts_at, interval_minutes, cancelled_at")
        .eq("id", orderId)
        .maybeSingle();
      expect(readBack.data?.status, "the order is not active on read back, so something is holding it").toBe("active");
      expect(readBack.data?.cancelled_at ?? null).toBeNull();
      expect(readBack.data?.entered_by, "the order is not attributed to the caregiver who entered it").toBe(caregiver.userId);

      // No pending state, asserted about the model rather than the row.
      const outsideDomain = await admin
        .from("resident_monitoring_orders")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(active,completed,cancelled,expired)");
      expect(outsideDomain.count ?? 0, "a Monitoring Order holds a status outside the four the model allows").toBe(0);

      // The order's own checks, spaced at its own interval with the grace the
      // interval scaled formula gives. Both read back, neither named here.
      const tasks = await admin
        .from("resident_observation_tasks")
        .select("id, due_at, grace_ends_at, window_key, monitoring_order_id, service_date")
        .eq("monitoring_order_id", orderId)
        .is("deleted_at", null)
        .order("due_at", { ascending: true });
      expect((tasks.data ?? []).length, "the order generated no checks, so it did not take effect on save").toBeGreaterThan(0);

      const grace = await admin.rpc("monitoring_order_grace_minutes", { p_interval_minutes: interval });
      expect(grace.error, grace.error ? `monitoring_order_grace_minutes failed: ${grace.error.message}` : undefined).toBeNull();
      const graceMinutes = grace.data as number;

      for (const row of tasks.data ?? []) {
        // An order task carries no window_key on purpose: a reserved key would
        // collide with the cadence index the moment an order started inside a
        // standard window. service_date is still stamped.
        expect(row.window_key, "an order task carries a window_key").toBeNull();
        expect(row.service_date, "an order task carries no service_date").not.toBeNull();
        const spanMinutes = (new Date(row.grace_ends_at).getTime() - new Date(row.due_at).getTime()) / 60_000;
        expect(spanMinutes, "an order task's grace does not match the interval scaled formula").toBe(graceMinutes);
      }

      const spacings = (tasks.data ?? [])
        .slice(1)
        .map((row, index) => (new Date(row.due_at).getTime() - new Date(tasks.data![index].due_at).getTime()) / 60_000);
      for (const spacing of spacings) {
        expect(spacing, "the order's checks are not spaced at its own interval").toBe(interval);
      }

      // Absorption is expectation derived, never row derived (decision D13).
      // The standard windows stop generating for this resident while the order
      // runs, so there is no task row to mark, and the compliance read still
      // projects the day's windows.
      const serviceDate = (tasks.data ?? [])[0]?.service_date as string;
      const compliance = await admin.rpc("observation_compliance_for_range", {
        p_facility_id: facility,
        p_from: serviceDate,
        p_to: serviceDate,
      });
      type Row = { resident_id: string; window_key: string | null; expectation_source: string };
      const forResident = ((compliance.data ?? []) as Row[]).filter((row) => row.resident_id === resident.data!.id);
      expect(
        forResident.length,
        "a resident under a Monitoring Order produces no compliance rows, which is the defect the projected read exists to remove",
      ).toBeGreaterThan(0);
    } finally {
      // Withdraw it. A Monitoring Order left behind by a test run is an
      // instruction somebody will work.
      const closedAt = new Date().toISOString();
      await admin
        .from("resident_monitoring_orders")
        .update({ status: "cancelled", cancelled_at: closedAt, cancelled_by: caregiver.userId, cancel_reason: "Acceptance run", deleted_at: closedAt })
        .eq("id", orderId);
      await admin.from("resident_observation_tasks").update({ deleted_at: closedAt }).eq("monitoring_order_id", orderId).is("deleted_at", null);
    }
  });
});
