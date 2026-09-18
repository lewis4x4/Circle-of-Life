import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  activateCadenceVersion,
  createCadenceVersion,
  fetchObservationConfigChangeLog,
  fetchObservationConfigOverview,
  rollbackCadenceVersion,
  sendTestEscalation,
  simulateCadenceChange,
} from "./cadence-settings-fetch";

/**
 * Every argument object is compared with toEqual rather than checked field by
 * field, so a renamed parameter, an added one, or a default quietly filled in
 * on the client fails here instead of on a hosted project.
 *
 * The reason for the strictness: a settings surface that sends the wrong
 * argument name gets a function-not-found from PostgREST, and that reads on
 * screen as the schedule failing to save rather than as a typo.
 */
function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const FACILITY = "facility-1";

describe("the cadence settings reads", () => {
  it("asks for the configuration in force with both proposal slots empty", async () => {
    const { supabase, rpc } = client({ data: { facility_id: FACILITY }, error: null });
    await fetchObservationConfigOverview(supabase, FACILITY);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("observation_config_overview", {
      p_facility_id: FACILITY,
      p_proposed_cadence_version_id: null,
      p_proposed_escalation_version_id: null,
    });
  });

  it("asks the same read for the preview, with the proposal on it", async () => {
    // One round trip for the whole preview, and the same command the activation
    // will act on. A second read computing its own numbers could show one thing
    // and commit another.
    const { supabase, rpc } = client({ data: { facility_id: FACILITY }, error: null });
    await fetchObservationConfigOverview(supabase, FACILITY, {
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
    });
    expect(rpc).toHaveBeenCalledWith("observation_config_overview", {
      p_facility_id: FACILITY,
      p_proposed_cadence_version_id: "cadence-2",
      p_proposed_escalation_version_id: null,
    });
  });

  it("reads the change log without naming a page size", async () => {
    // The page size comes from public.facility_observation_thresholds, so the
    // surface carries no number of its own.
    const { supabase, rpc } = client({ data: [], error: null });
    await fetchObservationConfigChangeLog(supabase, FACILITY);
    expect(rpc).toHaveBeenCalledWith("observation_config_change_log", {
      p_facility_id: FACILITY,
      p_limit: null,
    });
  });

  it("simulates without naming a lookback span", async () => {
    const { supabase, rpc } = client({ data: {}, error: null });
    await simulateCadenceChange(supabase, {
      facilityId: FACILITY,
      cadenceVersionId: "cadence-2",
      escalationVersionId: "escalation-2",
    });
    expect(rpc).toHaveBeenCalledWith("simulate_cadence_change", {
      p_facility_id: FACILITY,
      p_proposed_cadence_version_id: "cadence-2",
      p_proposed_escalation_version_id: "escalation-2",
      p_lookback_days: null,
    });
  });

  it("raises when the read refuses, so the surface never renders a half answer", async () => {
    const error = { code: "42501", message: "No access to this facility" };
    const { supabase } = client({ data: null, error });
    await expect(fetchObservationConfigOverview(supabase, FACILITY)).rejects.toBe(error);
  });

  it("raises when the read answers with nothing, naming the step", async () => {
    const { supabase } = client({ data: null, error: null });
    await expect(fetchObservationConfigOverview(supabase, FACILITY)).rejects.toThrow(
      "observation_config_overview returned nothing",
    );
  });
});

describe("the cadence settings writes", () => {
  const windows = [
    {
      window_key: "mid_morning",
      label: "Mid morning check",
      due_at_local: "11:00",
      grace_before_minutes: 60,
      grace_after_minutes: 60,
      shift_key: "day",
      sort_order: 1,
      enabled: true,
    },
  ];

  it("proposes a cadence change and passes null for the ladder it is not touching", async () => {
    // Passing an unchanged ladder would manufacture an escalation version
    // identical to the one in force, and the change log would carry a change
    // that did not happen.
    const { supabase, rpc } = client({ data: { cadence_version_id: "cadence-2" }, error: null });
    await createCadenceVersion(supabase, {
      facilityId: FACILITY,
      changeReason: "Moving the mid morning check an hour later.",
      windows,
      rungs: null,
    });
    expect(rpc).toHaveBeenCalledWith("create_cadence_version", {
      p_facility_id: FACILITY,
      p_change_reason: "Moving the mid morning check an hour later.",
      p_windows: windows,
      p_escalation_rungs: null,
      p_effective_from: null,
      p_source_cadence_template_id: null,
      p_source_escalation_template_id: null,
    });
  });

  it("proposes a ladder change and passes null for the schedule it is not touching", async () => {
    const rungs = [
      {
        rung_key: "tier_1",
        label: "First escalation",
        offset_minutes: 30,
        is_terminal: false,
        assigned_staff_only: false,
        include_assigned_staff: true,
        use_standing_alert_routes: false,
        target_staff_roles: ["administrator"],
        channels: ["in_app"],
        protocol_text: null,
        sort_order: 1,
        enabled: true,
      },
    ];
    const { supabase, rpc } = client({ data: { escalation_version_id: "escalation-2" }, error: null });
    await createCadenceVersion(supabase, {
      facilityId: FACILITY,
      changeReason: "Quieter overnight channels.",
      windows: null,
      rungs,
    });
    expect(rpc).toHaveBeenCalledWith("create_cadence_version", {
      p_facility_id: FACILITY,
      p_change_reason: "Quieter overnight channels.",
      p_windows: null,
      p_escalation_rungs: rungs,
      p_effective_from: null,
      p_source_cadence_template_id: null,
      p_source_escalation_template_id: null,
    });
  });

  it("activates with the effective timing, and sends no date unless it is scheduled", async () => {
    const { supabase, rpc } = client({ data: { in_force: true }, error: null });
    await activateCadenceVersion(supabase, {
      changeReason: "The Director of Operations signed off this morning.",
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
      applyMode: "next_shift_boundary",
      effectiveFrom: null,
      acknowledgment: null,
    });
    expect(rpc).toHaveBeenCalledWith("activate_cadence_version", {
      p_change_reason: "The Director of Operations signed off this morning.",
      p_cadence_version_id: "cadence-2",
      p_escalation_version_id: null,
      p_apply_mode: "next_shift_boundary",
      p_effective_from: null,
      p_acknowledgment: null,
    });
  });

  it("carries the typed acknowledgment through on an immediate apply", async () => {
    const { supabase, rpc } = client({ data: { in_force: true }, error: null });
    await activateCadenceVersion(supabase, {
      changeReason: "Applying now, the incoming shift has been told.",
      cadenceVersionId: "cadence-2",
      escalationVersionId: "escalation-2",
      applyMode: "immediate",
      effectiveFrom: null,
      acknowledgment: "Homewood Lodge, ALF",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_apply_mode).toBe("immediate");
    expect(args.p_acknowledgment).toBe("Homewood Lodge, ALF");
  });

  it("rolls a version forward without ever naming a version to delete", async () => {
    const { supabase, rpc } = client({ data: {}, error: null });
    await rollbackCadenceVersion(supabase, {
      facilityId: FACILITY,
      changeReason: "Undoing yesterday's change.",
      restoreCadenceVersionId: "cadence-1",
      restoreEscalationVersionId: null,
      applyMode: "next_shift_boundary",
      effectiveFrom: null,
      acknowledgment: null,
    });
    expect(rpc).toHaveBeenCalledWith("rollback_cadence_version", {
      p_facility_id: FACILITY,
      p_change_reason: "Undoing yesterday's change.",
      p_restore_cadence_version_id: "cadence-1",
      p_restore_escalation_version_id: null,
      p_apply_mode: "next_shift_boundary",
      p_effective_from: null,
      p_acknowledgment: null,
    });
    expect(rpc.mock.calls[0][0]).not.toContain("delete");
  });

  it("sends a test through the real routing for one named step", async () => {
    const { supabase, rpc } = client({ data: { rung_key: "tier_2" }, error: null });
    await sendTestEscalation(supabase, FACILITY, "tier_2");
    expect(rpc).toHaveBeenCalledWith("send_test_escalation", {
      p_facility_id: FACILITY,
      p_rung_key: "tier_2",
    });
  });

  it("puts a change reason on every write, so nothing lands on the record unexplained", async () => {
    // Spec 6.11 requires a reason on every configuration change. The commands
    // refuse a blank one; this is the client keeping its half of that.
    const writes: Array<[string, Record<string, unknown>]> = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      writes.push([name, args]);
      return Promise.resolve({ data: {}, error: null });
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    await createCadenceVersion(supabase, {
      facilityId: FACILITY,
      changeReason: "A",
      windows,
      rungs: null,
    });
    await activateCadenceVersion(supabase, {
      changeReason: "B",
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
      applyMode: "immediate",
      effectiveFrom: null,
      acknowledgment: "A Building",
    });
    await rollbackCadenceVersion(supabase, {
      facilityId: FACILITY,
      changeReason: "C",
      restoreCadenceVersionId: "cadence-1",
      restoreEscalationVersionId: null,
      applyMode: "next_shift_boundary",
      effectiveFrom: null,
      acknowledgment: null,
    });

    expect(writes).toHaveLength(3);
    for (const [name, args] of writes) {
      expect(Object.keys(args), `${name} lost its change reason`).toContain("p_change_reason");
      expect(typeof args.p_change_reason).toBe("string");
      expect((args.p_change_reason as string).length).toBeGreaterThan(0);
    }
  });

  it("raises the command's own refusal rather than swallowing it", async () => {
    const error = { code: "23514", message: "Two enabled windows overlap." };
    const { supabase } = client({ data: null, error });
    await expect(
      activateCadenceVersion(supabase, {
        changeReason: "Trying anyway.",
        cadenceVersionId: "cadence-2",
        escalationVersionId: null,
        applyMode: "immediate",
        effectiveFrom: null,
        acknowledgment: "A Building",
      }),
    ).rejects.toBe(error);
  });
});
