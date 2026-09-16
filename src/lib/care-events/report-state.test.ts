import { describe, expect, it } from "vitest";

import {
  EARLIER_MAX_MINUTES,
  answersForEngine,
  canSend,
  formatMinutesAgo,
  initialReportState,
  occurredAtIso,
  reportReducer,
  type ReportResident,
  type ReportState,
} from "./report-state";
import type { CareEventReceipt } from "./submit";

const BROWNELL: ReportResident = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Pat Brownell",
  firstName: "Pat",
  lastName: "Brownell",
  roomLabel: "Room 12",
};

const CLIENT_EVENT_ID = "22222222-2222-4222-8222-222222222222";

function start(): ReportState {
  return initialReportState(CLIENT_EVENT_ID);
}

function reduce(state: ReportState, ...actions: Parameters<typeof reportReducer>[1][]): ReportState {
  return actions.reduce(reportReducer, state);
}

describe("prefill", () => {
  it("skips Who when a resident is prefilled", () => {
    const state = reduce(start(), { type: "prefill", resident: BROWNELL, kind: null });
    expect(state.step).toBe("what");
    expect(state.resident).toEqual(BROWNELL);
  });

  it("skips Who and What when both are prefilled", () => {
    const state = reduce(start(), { type: "prefill", resident: BROWNELL, kind: "behavior" });
    expect(state.step).toBe("how_bad");
    expect(state.kind).toBe("behavior");
  });

  it("keeps Who when only a kind is prefilled, then jumps to How bad after the resident", () => {
    const state = reduce(start(), { type: "prefill", resident: null, kind: "condition_change" });
    expect(state.step).toBe("who");
    const next = reduce(state, { type: "pick_resident", resident: BROWNELL });
    expect(next.step).toBe("how_bad");
    expect(next.kind).toBe("condition_change");
  });

  it("drops a resident-only kind when the building is chosen instead", () => {
    const state = reduce(start(), { type: "prefill", resident: null, kind: "fall" }, { type: "no_resident" });
    expect(state.step).toBe("what");
    expect(state.kind).toBeNull();
    expect(state.resident).toBeNull();
    expect(state.whoAnswered).toBe(true);
  });

  it("keeps the environment kind when the building is chosen", () => {
    const state = reduce(start(), { type: "prefill", resident: null, kind: "environment" }, { type: "no_resident" });
    expect(state.step).toBe("how_bad");
    expect(state.kind).toBe("environment");
  });
});

describe("tiles and answers", () => {
  it("refuses a resident-only tile without a resident", () => {
    const state = reduce(start(), { type: "no_resident" }, { type: "pick_kind", kind: "fall" });
    expect(state.step).toBe("what");
    expect(state.kind).toBeNull();
  });

  it("replaces single-select answers", () => {
    const state = reduce(
      start(),
      { type: "pick_resident", resident: BROWNELL },
      { type: "pick_kind", kind: "fall" },
      { type: "set_answer", key: "hurt", value: "not_hurt" },
      { type: "set_answer", key: "hurt", value: "badly" },
    );
    expect(state.answers.hurt).toBe("badly");
  });

  it("toggles multi-select answers on and off", () => {
    const base = reduce(start(), { type: "pick_resident", resident: BROWNELL }, { type: "pick_kind", kind: "injury_found" });
    const on = reduce(base, { type: "toggle_answer", key: "seen", value: "bruise" }, { type: "toggle_answer", key: "seen", value: "burn" });
    expect(on.answers.seen).toEqual(["bruise", "burn"]);
    const off = reduce(on, { type: "toggle_answer", key: "seen", value: "bruise" });
    expect(off.answers.seen).toEqual(["burn"]);
  });

  it("clears answers when the tile changes", () => {
    const state = reduce(
      start(),
      { type: "pick_resident", resident: BROWNELL },
      { type: "pick_kind", kind: "fall" },
      { type: "set_answer", key: "hurt", value: "badly" },
      { type: "toggle_worried" },
      { type: "back" },
      { type: "pick_kind", kind: "medication" },
    );
    expect(state.answers).toEqual({});
    expect(state.worried).toBe(false);
  });

  it("toggles worried", () => {
    const state = reduce(start(), { type: "toggle_worried" });
    expect(state.worried).toBe(true);
    expect(reduce(state, { type: "toggle_worried" }).worried).toBe(false);
  });
});

describe("earlier stepper", () => {
  it("opens at 15 minutes and closes back to now", () => {
    const open = reduce(start(), { type: "toggle_earlier" });
    expect(open.earlierOpen).toBe(true);
    expect(open.minutesAgo).toBe(15);
    const closed = reduce(open, { type: "toggle_earlier" });
    expect(closed.earlierOpen).toBe(false);
    expect(closed.minutesAgo).toBe(0);
  });

  it("steps in 15s and clamps between 0 and 480", () => {
    let state = reduce(start(), { type: "toggle_earlier" });
    state = reduce(state, { type: "step_minutes", delta: 15 });
    expect(state.minutesAgo).toBe(30);
    state = reduce(state, { type: "step_minutes", delta: -15 }, { type: "step_minutes", delta: -15 }, { type: "step_minutes", delta: -15 });
    expect(state.minutesAgo).toBe(0);
    for (let i = 0; i < 40; i += 1) state = reduce(state, { type: "step_minutes", delta: 15 });
    expect(state.minutesAgo).toBe(EARLIER_MAX_MINUTES);
  });

  it("formats the display", () => {
    expect(formatMinutesAgo(0)).toBe("Just now");
    expect(formatMinutesAgo(15)).toBe("15 minutes ago");
    expect(formatMinutesAgo(60)).toBe("1 hour ago");
    expect(formatMinutesAgo(75)).toBe("1 hour 15 minutes ago");
    expect(formatMinutesAgo(480)).toBe("8 hours ago");
  });
});

describe("canSend", () => {
  it("requires every single-select answer and tolerates an empty multi-select", () => {
    let state = reduce(start(), { type: "pick_resident", resident: BROWNELL }, { type: "pick_kind", kind: "injury_found" });
    expect(canSend(state)).toBe(false);
    state = reduce(state, { type: "set_answer", key: "care", value: "first_aid_enough" });
    expect(canSend(state)).toBe(false);
    state = reduce(state, { type: "set_answer", key: "cause_known", value: "yes" });
    expect(canSend(state)).toBe(true);
  });

  it("is false while submitting and without a tile", () => {
    expect(canSend(start())).toBe(false);
    const state = reduce(
      start(),
      { type: "pick_resident", resident: BROWNELL },
      { type: "pick_kind", kind: "wandering" },
      { type: "set_answer", key: "where", value: "found_inside" },
      { type: "set_answer", key: "hurt", value: "no" },
    );
    expect(canSend(state)).toBe(true);
    expect(canSend(reduce(state, { type: "submit_start", sentAtIso: "2026-09-16T02:06:00.000Z" }))).toBe(false);
  });
});

describe("selectors", () => {
  it("answersForEngine carries worried and drops empty values", () => {
    const state = reduce(
      start(),
      { type: "pick_resident", resident: BROWNELL },
      { type: "pick_kind", kind: "fall" },
      { type: "set_answer", key: "hurt", value: "a_little" },
      { type: "toggle_answer", key: "seen", value: "bruise" },
      { type: "toggle_answer", key: "seen", value: "bruise" },
      { type: "toggle_worried" },
    );
    expect(answersForEngine(state)).toEqual({ hurt: "a_little", worried: true });
  });

  it("occurredAtIso is now minus the stepper minutes", () => {
    const now = new Date("2026-09-16T02:06:00.000Z");
    const state = reduce(start(), { type: "toggle_earlier" }, { type: "step_minutes", delta: 15 });
    expect(occurredAtIso(state, now)).toBe("2026-09-16T01:36:00.000Z");
    expect(occurredAtIso(start(), now)).toBe("2026-09-16T02:06:00.000Z");
  });
});

describe("submit lifecycle", () => {
  const receipt: CareEventReceipt = {
    care_event_id: "33333333-3333-4333-8333-333333333333",
    level: 2,
    incident_number: "HOM-2026-0007",
    incident_id: null,
    deliveries: [],
    next_check_at: null,
    replayed: false,
  };

  it("moves to the receipt on success and on an offline queue, then confirms", () => {
    const sent = reduce(start(), { type: "submit_start", sentAtIso: "x" }, { type: "submit_success", receipt });
    expect(sent.step).toBe("receipt");
    expect(sent.submitStatus).toBe("sent");
    const queued = reduce(start(), { type: "submit_start", sentAtIso: "x" }, { type: "offline_queued", sentAtIso: "y" });
    expect(queued.step).toBe("receipt");
    expect(queued.submitStatus).toBe("queued");
    expect(queued.receipt).toBeNull();
    const confirmed = reduce(queued, { type: "queue_confirmed", receipt });
    expect(confirmed.submitStatus).toBe("sent");
    expect(confirmed.receipt).toEqual(receipt);
  });

  it("stays on How bad with the failure line", () => {
    const state = reduce(
      start(),
      { type: "pick_resident", resident: BROWNELL },
      { type: "pick_kind", kind: "fall" },
      { type: "submit_start", sentAtIso: "x" },
      { type: "submit_failure", error: "The event was not sent." },
    );
    expect(state.step).toBe("how_bad");
    expect(state.submitStatus).toBe("failed");
    expect(state.submitError).toBe("The event was not sent.");
  });
});
