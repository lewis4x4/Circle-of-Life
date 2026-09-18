import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useObservationCadenceSettings } from "./useObservationCadenceSettings";
import type { ObservationConfigOverview } from "@/lib/rounding/cadence-settings";

/**
 * The five commands, each on its success path and its failure path.
 *
 * The failure paths are the point. A settings surface that answers
 * "Could not save. Retry." where the command said "Two enabled windows overlap"
 * has replaced the diagnosis with a shrug, which is the defect class that hid
 * three unrelated query bugs behind one sentence on the live board. Every
 * failure assertion below compares the whole message, never a substring.
 */

const reads = vi.hoisted(() => ({
  fetchObservationConfigOverview: vi.fn(),
  fetchObservationConfigChangeLog: vi.fn(),
  createCadenceVersion: vi.fn(),
  activateCadenceVersion: vi.fn(),
  rollbackCadenceVersion: vi.fn(),
  simulateCadenceChange: vi.fn(),
  sendTestEscalation: vi.fn(),
}));

vi.mock("@/lib/rounding/cadence-settings-fetch", () => reads);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
  isBrowserSupabaseConfigured: () => true,
}));

const FACILITY = "facility-1";

function overview(overrides: Partial<ObservationConfigOverview> = {}): ObservationConfigOverview {
  return {
    facility_id: FACILITY,
    facility_name: "A Building",
    timezone: "America/New_York",
    active_resident_count: 33,
    shifts: [
      { shift_key: "day", label: "Day", starts_at_local: "06:00", ends_at_local: "18:00", starts_minute: 360, ends_minute: 1080 },
      { shift_key: "night", label: "Night", starts_at_local: "18:00", ends_at_local: "06:00", starts_minute: 1080, ends_minute: 360 },
    ],
    cadence_template_id: "template-1",
    cadence_template_name: "COL Standard Six",
    escalation_template_id: "escalation-template-1",
    escalation_template_name: "COL Standard Ladder",
    jurisdiction_floor: null,
    thresholds: {
      maximum_unobserved_gap_minutes: 180,
      maximum_windows_per_resident_per_day: 8,
      simulation_lookback_days: 14,
      change_log_page_size: 10,
    },
    current: {
      cadence_version_id: "cadence-1",
      cadence_version_number: 1,
      cadence_effective_from: "2026-09-16T04:00:00.000Z",
      cadence_change_reason: "Seeded.",
      escalation_version_id: "escalation-1",
      escalation_version_number: 1,
      escalation_effective_from: "2026-09-16T04:00:00.000Z",
      day_shape: {
        cadence_version_id: "cadence-1",
        windows_per_day: 1,
        largest_unobserved_gap_minutes: 1380,
        largest_gap_starts_minute: 660,
        largest_gap_ends_minute: 2040,
        has_overlap: false,
        windows: [
          {
            window_key: "mid_morning",
            label: "Mid morning check",
            shift_key: "day",
            enabled: true,
            due_minute: 600,
            opens_minute: 540,
            closes_minute: 660,
            grace_before_minutes: 60,
            grace_after_minutes: 60,
            overlaps_window_keys: [],
          },
        ],
      },
      daily_task_total: 33,
      ladder: [
        {
          rung_key: "tier_1",
          label: "First escalation",
          offset_minutes: 30,
          is_terminal: false,
          assigned_staff_only: false,
          include_assigned_staff: true,
          use_standing_alert_routes: false,
          channels: ["in_app"],
          enabled: true,
          standing_alert_route_count: 1,
          roles: [{ staff_role: "administrator", holder_count: 1 }],
        },
      ],
    },
    proposed: null,
    next_shift_boundary_at: "2026-09-18T22:00:00.000Z",
    ...overrides,
  };
}

/** A PostgREST shaped refusal. `code` is the SQLSTATE the command raised. */
function refusal(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reads.fetchObservationConfigOverview.mockResolvedValue(overview());
  reads.fetchObservationConfigChangeLog.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mounted() {
  const rendered = renderHook(() => useObservationCadenceSettings(FACILITY));
  await waitFor(() => expect(rendered.result.current.loadState).toBe("ready"));
  return rendered;
}

describe("the initial read", () => {
  it("loads the configuration in force and fills the drafts from it", async () => {
    const { result } = await mounted();
    expect(result.current.overview?.facility_name).toBe("A Building");
    expect(result.current.windowDrafts).toEqual([
      {
        window_key: "mid_morning",
        label: "Mid morning check",
        due_at_local: "10:00",
        grace_before_minutes: 60,
        grace_after_minutes: 60,
        shift_key: "day",
        sort_order: 0,
        enabled: true,
      },
    ]);
    expect(result.current.rungDrafts[0].rung_key).toBe("tier_1");
    expect(result.current.dirty).toBe(false);
  });

  it("names the schedule rather than the query when the read refuses", async () => {
    reads.fetchObservationConfigOverview.mockRejectedValue(refusal("42703", "column does not exist"));
    const { result } = renderHook(() => useObservationCadenceSettings(FACILITY));
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.errorMessage).toBe(
      "The observation schedule could not be loaded for this building. Retry, or try again in a moment.",
    );
    // The diagnosis goes to the console, never onto the screen.
    expect(console.error).toHaveBeenCalled();
  });

  it("keeps the schedule on screen when only the change history refuses", async () => {
    reads.fetchObservationConfigChangeLog.mockRejectedValue(refusal("42501", "no access"));
    const { result } = await mounted();
    expect(result.current.overview).not.toBeNull();
    expect(result.current.errorMessage).toBe(
      "The change history could not be loaded for this building. Retry, or try again in a moment.",
    );
  });
});

describe("editing", () => {
  it("reads as changed once a due time moves, and back to unchanged when discarded", async () => {
    const { result } = await mounted();
    act(() => {
      result.current.setWindowDrafts((drafts) =>
        drafts.map((draft) => ({ ...draft, due_at_local: "11:00" })),
      );
    });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.resetDrafts());
    expect(result.current.dirty).toBe(false);
    expect(result.current.windowDrafts[0].due_at_local).toBe("10:00");
  });
});

describe("proposing a change", () => {
  it("sends only the kind that changed and reloads the read with the proposal on it", async () => {
    reads.createCadenceVersion.mockResolvedValue({
      status: "draft",
      cadence_version_id: "cadence-2",
      escalation_version_id: null,
      cadence_version_number: 2,
      escalation_version_number: null,
      provisional_effective_from: "2026-09-18T22:00:00.000Z",
    });
    const { result } = await mounted();
    act(() => {
      result.current.setWindowDrafts((drafts) =>
        drafts.map((draft) => ({ ...draft, due_at_local: "11:00" })),
      );
      result.current.setProposalReason("Moving the mid morning check an hour later.");
    });
    await act(async () => {
      await result.current.propose();
    });

    const args = reads.createCadenceVersion.mock.calls[0][1];
    expect(args.changeReason).toBe("Moving the mid morning check an hour later.");
    expect(args.windows?.[0].due_at_local).toBe("11:00");
    expect(args.rungs).toBeNull();
    expect(result.current.proposal).toEqual({
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
    });
    expect(reads.fetchObservationConfigOverview).toHaveBeenLastCalledWith(expect.anything(), FACILITY, {
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
    });
  });

  it("surfaces the command's own sentence when the proposal is refused", async () => {
    reads.createCadenceVersion.mockRejectedValue(
      refusal("22023", "A proposal has to change something: pass the observation windows, the escalation rungs, or both"),
    );
    const { result } = await mounted();
    act(() => result.current.setProposalReason("Nothing in particular."));
    await act(async () => {
      await result.current.propose();
    });
    expect(result.current.errorMessage).toBe(
      "A proposal has to change something: pass the observation windows, the escalation rungs, or both",
    );
    expect(result.current.proposal).toBeNull();
  });
});

describe("simulating", () => {
  async function withProposal() {
    reads.createCadenceVersion.mockResolvedValue({
      status: "draft",
      cadence_version_id: "cadence-2",
      escalation_version_id: null,
      cadence_version_number: 2,
      escalation_version_number: null,
      provisional_effective_from: "2026-09-18T22:00:00.000Z",
    });
    const rendered = await mounted();
    act(() => {
      rendered.result.current.setWindowDrafts((drafts) =>
        drafts.map((draft) => ({ ...draft, due_at_local: "11:00" })),
      );
      rendered.result.current.setProposalReason("Later mid morning check.");
    });
    await act(async () => {
      await rendered.result.current.propose();
    });
    return rendered;
  }

  it("replays the saved proposal and keeps the result", async () => {
    reads.simulateCadenceChange.mockResolvedValue({ lookback_days: 14, proposed: {}, in_force: {} });
    const { result } = await withProposal();
    await act(async () => {
      await result.current.simulate();
    });
    expect(reads.simulateCadenceChange.mock.calls[0][1]).toEqual({
      facilityId: FACILITY,
      cadenceVersionId: "cadence-2",
      escalationVersionId: null,
    });
    expect(result.current.simulation?.lookback_days).toBe(14);
  });

  it("surfaces the command's sentence when the replay is refused", async () => {
    reads.simulateCadenceChange.mockRejectedValue(
      refusal("22023", "This building has no simulation lookback configured, so name the number of days to replay"),
    );
    const { result } = await withProposal();
    await act(async () => {
      await result.current.simulate();
    });
    expect(result.current.errorMessage).toBe(
      "This building has no simulation lookback configured, so name the number of days to replay",
    );
    expect(result.current.simulation).toBeNull();
  });

  it("does nothing at all before a proposal has been saved", async () => {
    const { result } = await mounted();
    await act(async () => {
      await result.current.simulate();
    });
    expect(reads.simulateCadenceChange).not.toHaveBeenCalled();
  });
});

describe("putting a change in force", () => {
  async function withProposal() {
    reads.createCadenceVersion.mockResolvedValue({
      status: "draft",
      cadence_version_id: "cadence-2",
      escalation_version_id: null,
      cadence_version_number: 2,
      escalation_version_number: null,
      provisional_effective_from: "2026-09-18T22:00:00.000Z",
    });
    const rendered = await mounted();
    act(() => {
      rendered.result.current.setWindowDrafts((drafts) =>
        drafts.map((draft) => ({ ...draft, due_at_local: "11:00" })),
      );
      rendered.result.current.setProposalReason("Later mid morning check.");
    });
    await act(async () => {
      await rendered.result.current.propose();
    });
    act(() => rendered.result.current.setActivationReason("Signed off this morning."));
    return rendered;
  }

  it("reports a future dated change as scheduled and says the board does not move", async () => {
    reads.activateCadenceVersion.mockResolvedValue({
      effective_from: "2026-09-18T22:00:00.000Z",
      scheduled: true,
      in_force: false,
      acknowledgment_required: false,
    });
    const { result } = await withProposal();
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.notice).toContain("Scheduled.");
    expect(result.current.notice).toContain("nothing on the board changes before then");
    // A committed change clears the editor, so the surface is not showing a
    // proposal that is already in the timeline.
    expect(result.current.proposal).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it("reports an immediate apply as in force and names what it did and did not touch", async () => {
    reads.activateCadenceVersion.mockResolvedValue({
      effective_from: "2026-09-18T14:00:00.000Z",
      scheduled: false,
      in_force: true,
      acknowledgment_required: true,
    });
    const { result } = await withProposal();
    act(() => {
      result.current.setApplyMode("immediate");
      result.current.setAcknowledgment("A Building");
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(reads.activateCadenceVersion.mock.calls[0][1]).toMatchObject({
      applyMode: "immediate",
      acknowledgment: "A Building",
      effectiveFrom: null,
    });
    expect(result.current.notice).toBe(
      "In force now. Pending checks past this moment were cancelled and will be rebuilt on the new schedule. Nothing completed, missed or already escalated was touched.",
    );
  });

  it("sends the scheduled date only when the timing is scheduled", async () => {
    reads.activateCadenceVersion.mockResolvedValue({
      effective_from: "2026-09-20T10:00:00.000Z",
      scheduled: true,
      in_force: false,
      acknowledgment_required: true,
    });
    const { result } = await withProposal();
    act(() => {
      result.current.setApplyMode("scheduled");
      result.current.setScheduledFor("2026-09-20T10:00");
      result.current.setAcknowledgment("A Building");
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(reads.activateCadenceVersion.mock.calls[0][1]).toMatchObject({
      applyMode: "scheduled",
      effectiveFrom: "2026-09-20T10:00",
    });
  });

  it("surfaces the acknowledgment refusal in the command's own words", async () => {
    reads.activateCadenceVersion.mockRejectedValue(
      refusal(
        "22023",
        "This change needs a typed acknowledgment because the change applies immediately and cancels the pending checks on the current board. Type the building name exactly to confirm",
      ),
    );
    const { result } = await withProposal();
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.errorMessage).toBe(
      "This change needs a typed acknowledgment because the change applies immediately and cancels the pending checks on the current board. Type the building name exactly to confirm",
    );
    // A refused activation leaves the proposal in hand so the administrator can
    // type the name and try again rather than rebuild the edit.
    expect(result.current.proposal).not.toBeNull();
  });

  it("surfaces the role refusal in the command's own words", async () => {
    reads.activateCadenceVersion.mockRejectedValue(
      refusal(
        "42501",
        "Putting an observation cadence or escalation change in force needs an organization administrator or the owner. A facility administrator proposes the change and somebody at the organization approves it",
      ),
    );
    const { result } = await withProposal();
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.errorMessage).toBe(
      "Putting an observation cadence or escalation change in force needs an organization administrator or the owner. A facility administrator proposes the change and somebody at the organization approves it",
    );
  });

  /**
   * Every one of the six hard blocks reaches the caller as its own sentence.
   *
   * This started as a defect and the record is worth keeping. The raise in
   * `activate_cadence_version` carried SQLSTATE 23514 for one commit. 23514 is
   * `check_violation` and is deliberately absent from `COMMAND_REFUSAL_CODES`
   * in `src/lib/rounding/rounding-query-error.ts`, because any CHECK constraint
   * anywhere in the module raises it and its text is raw Postgres. The effect
   * was that the six messages an administrator most needs to read - the
   * overlap, the shift with nothing on it, the early opening at a shift start -
   * were the only refusals in the whole module that arrived on screen as "that
   * could not be done, retry". The block was enforced; the reason was not
   * legible.
   *
   * The fix was one token: raise them with 22023, which every other refusal in
   * migrations 425 and 426 already uses and which means, here, a stated rule
   * about the input. Widening the shared refusal set would have been the wrong
   * fix, trading one invisible message for many unreadable ones.
   *
   * The messages below are the exact strings
   * `scripts/smart-rounding/config-invariants-acceptance.sql` produces, and the
   * comparison is whole-string, so genericising any one of them fails here.
   *
   * The errcode itself is guarded where it lives. This file mocks the refusal,
   * so it cannot see the migration change: assertion 18 in
   * `supabase/tests/review_smart_rounding_authority.sql` reads the function body
   * and refuses any code but 22023. Both halves are needed - one holds the
   * sentences, the other holds the code that lets them through.
   */
  const HARD_BLOCKS: Array<[string, string]> = [
    [
      "overlapping_grace_spans",
      "Two enabled windows overlap. afternoon and mid_morning share time, so one observation would satisfy both windows and silently inflate compliance.",
    ],
    [
      "shift_without_window",
      "The Night shift has no enabled observation window. Every defined shift must carry at least one check.",
    ],
    [
      "shift_start_grace_before",
      "Morning shift change check is due at the start of the Day shift and opens 60 minutes early. The incoming shift must be the one that lays eyes on the resident, so grace before has to be zero on a window due at a shift start.",
    ],
    [
      "rung_offsets_not_increasing",
      "Escalation rung offsets are not strictly increasing. tier_1 fires at 30 minutes and tier_2 fires at 30 minutes, so the later rung does not come later.",
    ],
    [
      "terminal_rung_disabled",
      "The terminal escalation rung Final escalation is disabled. The last rung protocol may be rewritten but its existence may not be turned off.",
    ],
    [
      "below_jurisdiction_floor",
      "5 enabled windows per 24 hours is below the ZZ_SYNTHETIC floor of 6. The regulator minimum may not be configured away.",
    ],
  ];

  it.each(HARD_BLOCKS)("surfaces the %s block in the command's own words", async (_code, message) => {
    reads.activateCadenceVersion.mockRejectedValue(refusal("22023", message));
    const { result } = await withProposal();
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.errorMessage).toBe(message);
    expect(result.current.errorMessage).not.toBe(
      "That change could not be put in force. Retry, or try again in a moment.",
    );
  });

  it("covers all six hard blocks, not one of them", () => {
    // All six were invisible, so all six are asserted. A list that quietly
    // shrank would leave the next one to regress uncovered.
    expect(HARD_BLOCKS).toHaveLength(6);
    expect(new Set(HARD_BLOCKS.map(([code]) => code)).size).toBe(6);
    expect(new Set(HARD_BLOCKS.map(([, message]) => message)).size).toBe(6);
  });

  it("keeps the generic sentence for a failure that is not the command refusing", async () => {
    // The fallback still has a job. A dropped connection or a missing column is
    // a defect for the console, not a sentence for an operator.
    reads.activateCadenceVersion.mockRejectedValue(refusal("42703", 'column "x" does not exist'));
    const { result } = await withProposal();
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.errorMessage).toBe(
      "That change could not be put in force. Retry, or try again in a moment.",
    );
  });

});

describe("rolling back", () => {
  const entry = {
    kind: "cadence" as const,
    version_id: "cadence-1",
    version_number: 1,
    status: "superseded",
    effective_from: "2026-09-16T04:00:00.000Z",
    effective_to: "2026-09-18T22:00:00.000Z",
    change_reason: "Seeded.",
    activation_reason: null,
    apply_mode: null,
    created_at: "2026-09-16T04:00:00.000Z",
    created_by_name: null,
    activated_at: "2026-09-16T04:00:00.000Z",
    activated_by_name: null,
    source_template_id: null,
    rows: [],
    previous_rows: [],
  };

  it("copies the older version forward and never asks for a deletion", async () => {
    reads.rollbackCadenceVersion.mockResolvedValue({});
    const { result } = await mounted();
    await act(async () => {
      await result.current.rollback(entry);
    });
    const args = reads.rollbackCadenceVersion.mock.calls[0][1];
    expect(args).toMatchObject({
      facilityId: FACILITY,
      restoreCadenceVersionId: "cadence-1",
      restoreEscalationVersionId: null,
      applyMode: "next_shift_boundary",
      acknowledgment: "A Building",
    });
    expect(args.changeReason).toBe("Going back to observation schedule version 1.");
    expect(result.current.notice).toBe(
      "The older schedule was copied forward and scheduled for the next shift boundary.",
    );
  });

  it("restores an escalation version through the escalation slot, not the cadence one", async () => {
    reads.rollbackCadenceVersion.mockResolvedValue({});
    const { result } = await mounted();
    await act(async () => {
      await result.current.rollback({ ...entry, kind: "escalation", version_id: "escalation-1" });
    });
    expect(reads.rollbackCadenceVersion.mock.calls[0][1]).toMatchObject({
      restoreCadenceVersionId: null,
      restoreEscalationVersionId: "escalation-1",
    });
  });

  it("surfaces the command's sentence when the rollback is refused", async () => {
    reads.rollbackCadenceVersion.mockRejectedValue(
      refusal("22023", "That cadence version does not belong to this building"),
    );
    const { result } = await mounted();
    await act(async () => {
      await result.current.rollback(entry);
    });
    expect(result.current.errorMessage).toBe("That cadence version does not belong to this building");
  });
});

describe("the test send", () => {
  it("reports what went out and that nothing was recorded", async () => {
    reads.sendTestEscalation.mockResolvedValue({
      rung_key: "tier_2",
      label: "Second escalation",
      shift_key: "day",
      recipients: 1,
      deliveries_queued: 2,
      escalation_recorded: false,
    });
    const { result } = await mounted();
    await act(async () => {
      await result.current.testSend("tier_2");
    });
    expect(reads.sendTestEscalation).toHaveBeenCalledWith(expect.anything(), FACILITY, "tier_2");
    expect(result.current.notice).toBe(
      "Test sent for Second escalation over 2 deliveries, with TEST as the first word. Nothing was recorded against a resident and no check was touched.",
    );
    expect(result.current.testSendRungKey).toBeNull();
  });

  it("clears the busy step even when the send is refused", async () => {
    reads.sendTestEscalation.mockRejectedValue(
      refusal("22023", "No enabled escalation rung named tier_9 is in force at this facility"),
    );
    const { result } = await mounted();
    await act(async () => {
      await result.current.testSend("tier_9");
    });
    expect(result.current.errorMessage).toBe(
      "No enabled escalation rung named tier_9 is in force at this facility",
    );
    expect(result.current.testSendRungKey).toBeNull();
  });
});
