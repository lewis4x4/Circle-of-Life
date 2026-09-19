import { describe, expect, it } from "vitest";

import {
  calculateObservationTaskStatus,
  getCompletionTaskStatus,
  type ObservationBoardPolicy,
} from "@/lib/rounding/update-task-status";

/**
 * The guard on the Part 8 review finding.
 *
 * `update-task-status.ts` used to recompute `overdue`, `critically_overdue` and
 * `missed` from three constants. Part 4 had already replaced the escalation
 * engine, so those statuses were being written server side from
 * `facility_escalation_rungs`, and the board was painting its own answer from
 * numbers an administrator could not see or change. Move a rung in the settings
 * surface and the two disagreed, with nothing on screen to say which was real.
 *
 * Every test here asserts behaviour rather than the absence of a string,
 * because a grep for `30` is satisfied by renaming the constant. The
 * load-bearing ones are:
 *
 *   - the same clock and two different policies give two different answers,
 *     which is only true if the answer comes from the row
 *   - a status the server owns survives untouched, at any distance past the
 *     window, which the old arithmetic could not do
 *
 * Reintroducing the constants fails both. Literals in this file are the
 * allowance acceptance 19 makes for tests: a test has to name a value.
 */

const WINDOW_CLOSES_AT = "2026-09-18T14:00:00.000Z";
const DUE_AT = "2026-09-18T13:00:00.000Z";

/** A ladder shaped like the seeded one: a nudge, two tiers, a terminal rung. */
function policy(overrides: Partial<ObservationBoardPolicy> = {}): ObservationBoardPolicy {
  return {
    upcomingLeadMinutes: 30,
    rungs: [
      { offsetMinutes: -15, isTerminal: false, assignedStaffOnly: true },
      { offsetMinutes: 30, isTerminal: false, assignedStaffOnly: false },
      { offsetMinutes: 60, isTerminal: false, assignedStaffOnly: false },
      { offsetMinutes: 90, isTerminal: true, assignedStaffOnly: false },
    ],
    ...overrides,
  };
}

function minutesAfterClose(minutes: number): string {
  return new Date(new Date(WINDOW_CLOSES_AT).getTime() + minutes * 60_000).toISOString();
}

function minutesBeforeDue(minutes: number): string {
  return new Date(new Date(DUE_AT).getTime() - minutes * 60_000).toISOString();
}

function statusAt(now: string, input: { status?: Parameters<typeof calculateObservationTaskStatus>[0]["status"]; policy?: ObservationBoardPolicy } = {}) {
  return calculateObservationTaskStatus({
    status: input.status ?? "upcoming",
    dueAt: DUE_AT,
    graceEndsAt: WINDOW_CLOSES_AT,
    now,
    policy: input.policy ?? policy(),
  });
}

describe("calculateObservationTaskStatus", () => {
  describe("a status the server owns is never recomputed", () => {
    // The whole finding, in one table. The old implementation ignored the row's
    // status entirely and answered from the clock, so every one of these
    // returned something else once the window had been closed long enough.
    it.each([
      "overdue",
      "critically_overdue",
      "missed",
      "completed_on_time",
      "completed_late",
      "excused",
      "reassigned",
      "escalated",
    ] as const)("returns %s unchanged however far past the window it is read", (status) => {
      expect(statusAt(minutesAfterClose(5), { status })).toBe(status);
      expect(statusAt(minutesAfterClose(500), { status })).toBe(status);
    });

    it("keeps overdue rather than promoting it, which the retired arithmetic could not do", () => {
      // Past the second tier's offset. The old code answered critically_overdue
      // at anything over half an hour past grace and missed after two hours;
      // the engine is the only thing that promotes a task now.
      expect(statusAt(minutesAfterClose(75), { status: "overdue" })).toBe("overdue");
      expect(statusAt(minutesAfterClose(200), { status: "overdue" })).toBe("overdue");
    });
  });

  describe("due_soon follows the configured lead, not a constant", () => {
    it("reads upcoming outside the lead and due_soon inside it", () => {
      const lead = 30;
      const configured = policy({ upcomingLeadMinutes: lead });
      expect(statusAt(minutesBeforeDue(lead + 1), { policy: configured })).toBe("upcoming");
      expect(statusAt(minutesBeforeDue(lead - 1), { policy: configured })).toBe("due_soon");
    });

    it("gives a different answer at the same instant when the building configures a different lead", () => {
      // The load-bearing assertion for the threshold half. One clock, two
      // rows, two answers. A constant cannot produce this.
      const at = minutesBeforeDue(45);
      expect(statusAt(at, { policy: policy({ upcomingLeadMinutes: 30 }) })).toBe("upcoming");
      expect(statusAt(at, { policy: policy({ upcomingLeadMinutes: 60 }) })).toBe("due_soon");
    });
  });

  describe("due_now needs no policy value at all", () => {
    it("is the span between the check being due and its window closing", () => {
      expect(statusAt(new Date(new Date(DUE_AT).getTime() + 1).toISOString())).toBe("due_now");
      expect(statusAt(minutesAfterClose(-1))).toBe("due_now");
    });
  });

  describe("past the window, the ladder in force answers", () => {
    it("reads overdue until a rung is reached", () => {
      // The first rung past close sits at 30 in this ladder, so 29 minutes past
      // is a lapse nobody has escalated.
      expect(statusAt(minutesAfterClose(29))).toBe("overdue");
    });

    it("reads critically_overdue once a tier rung is reached and missed once the terminal rung is", () => {
      expect(statusAt(minutesAfterClose(30))).toBe("critically_overdue");
      expect(statusAt(minutesAfterClose(89))).toBe("critically_overdue");
      expect(statusAt(minutesAfterClose(90))).toBe("missed");
      expect(statusAt(minutesAfterClose(900))).toBe("missed");
    });

    it("gives a different answer at the same instant when the building moves a rung", () => {
      // This is the defect, reproduced as a passing assertion. An administrator
      // moving tier 1 from 30 to 45 changes what the board says at 40 minutes
      // past the window. Under the retired constants both of these answered
      // critically_overdue and the settings surface had no effect.
      const at = minutesAfterClose(40);
      const asSeeded = policy();
      const moved = policy({
        rungs: [
          { offsetMinutes: -15, isTerminal: false, assignedStaffOnly: true },
          { offsetMinutes: 45, isTerminal: false, assignedStaffOnly: false },
          { offsetMinutes: 90, isTerminal: true, assignedStaffOnly: false },
        ],
      });
      expect(statusAt(at, { policy: asSeeded })).toBe("critically_overdue");
      expect(statusAt(at, { policy: moved })).toBe("overdue");
    });

    it("never promotes a task on the nudge, because a nudge is not an escalation", () => {
      // The nudge writes a dispatch row and no escalation, and
      // record_observation_escalation_rung leaves the task's status alone for a
      // rung addressed only to the assigned staff member.
      const nudgeOnly = policy({
        rungs: [{ offsetMinutes: 10, isTerminal: false, assignedStaffOnly: true }],
      });
      expect(statusAt(minutesAfterClose(20), { policy: nudgeOnly })).toBe("overdue");
    });

    it("reads overdue when the ladder is empty rather than inventing a band", () => {
      expect(statusAt(minutesAfterClose(600), { policy: policy({ rungs: [] }) })).toBe("overdue");
    });

    it("does not depend on the order the rungs arrive in", () => {
      const shuffled = policy({
        rungs: [
          { offsetMinutes: 90, isTerminal: true, assignedStaffOnly: false },
          { offsetMinutes: 30, isTerminal: false, assignedStaffOnly: false },
          { offsetMinutes: -15, isTerminal: false, assignedStaffOnly: true },
          { offsetMinutes: 60, isTerminal: false, assignedStaffOnly: false },
        ],
      });
      expect(statusAt(minutesAfterClose(35), { policy: shuffled })).toBe("critically_overdue");
      expect(statusAt(minutesAfterClose(95), { policy: shuffled })).toBe("missed");
    });
  });

  describe("an unreadable timestamp", () => {
    it("answers with the row's own status rather than calling the check missed", () => {
      // The retired implementation returned "missed" for an unparseable date,
      // which turns a defect in one column into a compliance failure against a
      // building.
      expect(
        calculateObservationTaskStatus({
          status: "upcoming",
          dueAt: "not a date",
          graceEndsAt: WINDOW_CLOSES_AT,
          now: minutesAfterClose(10),
          policy: policy(),
        }),
      ).toBe("upcoming");
    });
  });
});

describe("getCompletionTaskStatus", () => {
  it("is on time inside the window and late outside it, from the window close on the row", () => {
    expect(getCompletionTaskStatus({ observedAt: minutesAfterClose(-1), graceEndsAt: WINDOW_CLOSES_AT })).toBe("completed_on_time");
    expect(getCompletionTaskStatus({ observedAt: WINDOW_CLOSES_AT, graceEndsAt: WINDOW_CLOSES_AT })).toBe("completed_on_time");
    expect(getCompletionTaskStatus({ observedAt: minutesAfterClose(1), graceEndsAt: WINDOW_CLOSES_AT })).toBe("completed_late");
  });
});
