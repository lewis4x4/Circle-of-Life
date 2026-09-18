import { expect, test } from "@playwright/test";

import { windowDraftsFrom, type ObservationConfigOverview } from "../../src/lib/rounding/cadence-settings";
import { adminClient, facilityId, roleClient, skipUnlessEnabled } from "./_helpers";

/**
 * A cadence change, end to end: propose, validate, simulate, activate, roll
 * back. Spec 25A acceptance items 15, 16 and 17, and decision D14's four test
 * points reduced to the one that matters most on a live project.
 *
 * `scripts/smart-rounding/run-config-invariants-acceptance.mjs` already proves
 * items 15 through 18, 20 and 21 against a replayed schema, so this file does
 * not repeat those assertions. What it adds is the thing a replay cannot reach:
 * the same sequence through the real RPCs on the caller's own authority, with
 * row level security and Supabase default privileges in force, against a
 * facility that has real task rows stamped with real version ids.
 *
 * The anti-rewrite check is the assertion to read first. A compliance report
 * run for a date before the change has to recompute to the same numbers after
 * it. If it does not, then moving a window in March silently rewrites February,
 * and an inspector pulling six months of observation records gets a report
 * computed against times that were never in force.
 *
 * The change this file makes is a label, not a time. Moving a real building's
 * observation schedule as a side effect of a test run is not a cost worth
 * paying, and the invariants under test -- a new version row, the prior version
 * untouched, the same numbers before and after, a rollback that copies forward
 * rather than deleting -- do not depend on which field changed.
 */
skipUnlessEnabled();

test.describe("cadence change", () => {
  test("propose, validate, simulate, activate and roll back, with the prior version and the prior numbers untouched", async () => {
    const admin = adminClient();
    const facility = facilityId();
    // Section 6.12 puts configuration in an administrator's hands. Using the
    // administrator account rather than the service role is the point: the RPCs
    // are definers with an explicit search_path and a role gate, and a replay
    // cannot tell whether the gate is the thing letting the call through.
    const operator = await roleClient("facility_admin");

    const overviewBefore = await operator.client.rpc("observation_config_overview", {
      p_facility_id: facility,
      p_proposed_cadence_version_id: null,
      p_proposed_escalation_version_id: null,
    });
    expect(
      overviewBefore.error,
      overviewBefore.error ? `observation_config_overview refused the administrator: ${overviewBefore.error.message}` : undefined,
    ).toBeNull();
    // The overview type and the draft mapping are the shipped ones, imported
    // rather than restated. A test that keeps its own copy of the payload shape
    // passes against a surface it no longer matches.
    const before = overviewBefore.data as ObservationConfigOverview;
    const priorVersionId = before.current.cadence_version_id;
    expect(priorVersionId, `facility ${facility} has no cadence version in force`).toBeTruthy();
    const windowsBefore = windowDraftsFrom(before.current.day_shape);
    expect(windowsBefore.length, "the version in force defines no windows").toBeGreaterThan(0);

    // The compliance answer for a settled past date, captured before anything
    // changes. Yesterday, in service dates, so the range cannot include the
    // instant the change takes force.
    const oneDayMs = 24 * 60 * 60 * 1000;
    const yesterday = new Date(Date.now() - oneDayMs).toISOString().slice(0, 10);
    const complianceBefore = await operator.client.rpc("observation_compliance_for_range", {
      p_facility_id: facility,
      p_from: yesterday,
      p_to: yesterday,
    });
    expect(complianceBefore.error, complianceBefore.error ? complianceBefore.error.message : undefined).toBeNull();
    const shapeOf = (rows: unknown[]) => {
      type Row = { window_key: string | null; satisfied: boolean; expectation_source: string };
      const typed = rows as Row[];
      const byWindow: Record<string, number> = {};
      for (const row of typed) {
        const key = row.window_key ?? "no_cadence";
        byWindow[key] = (byWindow[key] ?? 0) + 1;
      }
      return {
        expected: typed.length,
        satisfied: typed.filter((row) => row.satisfied).length,
        unconfigured: typed.filter((row) => row.expectation_source === "no_cadence").length,
        byWindow,
      };
    };
    const shapeBefore = shapeOf(complianceBefore.data ?? []);

    // Propose. Only the label of the first window moves.
    const windows = windowsBefore.map((window) => ({ ...window }));
    const renamedKey = windows[0].window_key;
    const originalLabel = windows[0].label;
    windows[0].label = `${originalLabel} (acceptance run)`;

    const created = await operator.client.rpc("create_cadence_version", {
      p_facility_id: facility,
      p_change_reason: "Spec 25A acceptance run: label only change, rolled back in the same test.",
      p_windows: windows,
      p_escalation_rungs: null,
      p_effective_from: null,
      p_source_cadence_template_id: null,
      p_source_escalation_template_id: null,
    });
    expect(created.error, created.error ? `create_cadence_version refused: ${created.error.message}` : undefined).toBeNull();
    const proposal = created.data as { cadence_version_id: string | null };
    const proposedId = proposal.cadence_version_id;
    expect(proposedId, "create_cadence_version returned no cadence version id").toBeTruthy();
    expect(proposedId, "the proposal reused the version already in force, which would be an in place mutation").not.toBe(priorVersionId);

    // Validate. Acceptance 17's six hard blocks are proven exhaustively by the
    // config invariants script; here the assertion is that a clean proposal
    // passes, so a green activation below is not a validator that never ran.
    const validation = await operator.client.rpc("validate_cadence_version", {
      p_cadence_version_id: proposedId,
      p_escalation_version_id: null,
    });
    expect(validation.error, validation.error ? `validate_cadence_version failed: ${validation.error.message}` : undefined).toBeNull();
    const validated = validation.data as { ok: boolean; blocks: unknown[]; warnings: unknown[] };
    expect(validated.blocks, "validate_cadence_version answered without a blocks list").toBeDefined();
    expect(validated.blocks.length, "a label only change was blocked").toBe(0);
    expect(validated.ok, "validate_cadence_version reports not ok with no blocks").toBe(true);

    // Simulate. The lookback span comes from the facility row, so the caller
    // names none.
    const simulation = await operator.client.rpc("simulate_cadence_change", {
      p_facility_id: facility,
      p_proposed_cadence_version_id: proposedId,
      p_proposed_escalation_version_id: null,
      p_lookback_days: null,
    });
    expect(simulation.error, simulation.error ? `simulate_cadence_change failed: ${simulation.error.message}` : undefined).toBeNull();
    const simulated = simulation.data as Record<string, unknown>;
    // Acceptance 18: both sides, not just the proposal. A simulation that
    // reports only the proposed configuration gives an administrator a number
    // with nothing to compare it to.
    expect(
      Object.keys(simulated),
      "the simulation does not report the in force configuration, the proposal and what staff actually recorded",
    ).toEqual(expect.arrayContaining(["in_force", "proposed", "recorded", "change"]));
    // And it says what it is. Replaying a proposal against recorded
    // observations measures the past; staff behaviour changes when the
    // schedule does, so the surface must not read as a forecast.
    expect(simulated.is_measurement_not_forecast, "the simulation no longer declares itself a measurement").toBe(true);

    let activatedId: string | null = null;
    try {
      const activation = await operator.client.rpc("activate_cadence_version", {
        p_change_reason: "Spec 25A acceptance run.",
        p_cadence_version_id: proposedId,
        p_escalation_version_id: null,
        p_apply_mode: "next_shift_boundary",
        p_effective_from: null,
        p_acknowledgment: null,
      });
      expect(activation.error, activation.error ? `activate_cadence_version refused: ${activation.error.message}` : undefined).toBeNull();
      activatedId = proposedId;

      // Acceptance 15: a new row, and the prior version's dates untouched.
      const prior = await admin
        .from("facility_cadence_versions")
        .select("id, status, effective_from, effective_to")
        .eq("id", priorVersionId!)
        .maybeSingle();
      expect(prior.data?.effective_from, "activating a new version moved the prior version's effective_from").toBe(
        before.current.cadence_effective_from,
      );
      expect(
        ["active", "superseded"],
        "the prior version left the timeline rather than being superseded",
      ).toContain(prior.data?.status);

      // D19: the timeline is a database constraint. Adjacency, not overlap.
      const proposedRow = await admin
        .from("facility_cadence_versions")
        .select("effective_from, effective_to, status, version_number")
        .eq("id", proposedId!)
        .maybeSingle();
      if (prior.data?.status === "superseded") {
        expect(prior.data.effective_to, "the outgoing version's effective_to does not close at the incoming version's effective_from").toBe(
          proposedRow.data?.effective_from,
        );
      }

      // Acceptance 16, the anti-rewrite check. Same range, same numbers.
      const complianceAfter = await operator.client.rpc("observation_compliance_for_range", {
        p_facility_id: facility,
        p_from: yesterday,
        p_to: yesterday,
      });
      expect(complianceAfter.error, complianceAfter.error ? complianceAfter.error.message : undefined).toBeNull();
      const shapeAfter = shapeOf(complianceAfter.data ?? []);
      expect(
        shapeAfter,
        "a compliance report for a settled date changed when the cadence changed, which means changing a window rewrites history",
      ).toEqual(shapeBefore);

      // And the label change actually reached the surface the board reads.
      const projected = await operator.client.rpc("facility_observation_windows_for_date", {
        p_facility_id: facility,
        p_service_date: new Date(Date.now() + oneDayMs).toISOString().slice(0, 10),
      });
      const tomorrow = (projected.data ?? []) as { window_key: string; label: string }[];
      const renamed = tomorrow.find((window) => window.window_key === renamedKey);
      if (renamed) {
        expect(renamed.label, "the activated version's label is not what the projector answers with").toContain("(acceptance run)");
      }
    } finally {
      // Roll back by copying the prior version forward. Never by deleting the
      // one this test activated: a version that was in force stays on the
      // record, which is what makes the change log worth consulting.
      if (activatedId && priorVersionId) {
        const rolledBack = await operator.client.rpc("rollback_cadence_version", {
          p_facility_id: facility,
          p_change_reason: "Spec 25A acceptance run: restoring the configuration this run changed.",
          p_restore_cadence_version_id: priorVersionId,
          p_restore_escalation_version_id: null,
          p_apply_mode: "immediate",
          p_effective_from: null,
          p_acknowledgment: null,
        });
        expect(rolledBack.error, rolledBack.error ? `rollback_cadence_version failed: ${rolledBack.error.message}` : undefined).toBeNull();

        const restored = await operator.client.rpc("observation_config_overview", {
          p_facility_id: facility,
          p_proposed_cadence_version_id: null,
          p_proposed_escalation_version_id: null,
        });
        const after = restored.data as ObservationConfigOverview;
        const restoredWindow = windowDraftsFrom(after.current.day_shape).find((window) => window.window_key === renamedKey);
        expect(restoredWindow?.label, "the rollback did not restore the label the run changed").toBe(originalLabel);
        expect(
          after.current.cadence_version_id,
          "the rollback restored the prior version row itself rather than copying it forward as a new version",
        ).not.toBe(priorVersionId);

        // The version this run activated is still on the record.
        const activatedRow = await admin
          .from("facility_cadence_versions")
          .select("id, status, deleted_at")
          .eq("id", activatedId)
          .maybeSingle();
        expect(activatedRow.data?.id, "the rollback deleted the version it replaced").toBe(activatedId);
      }
    }
  });
});
