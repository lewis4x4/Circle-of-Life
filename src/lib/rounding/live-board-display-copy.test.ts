import { describe, expect, it } from "vitest";

import type { LiveBoardShiftRow, LiveBoardWindowRow } from "./live-board-fetch";
import {
  liveBoardEmptyCopy,
  liveBoardFilterEmptyCopy,
  liveBoardRoomLabel,
  liveBoardRungLabel,
  liveBoardShiftLabel,
  liveBoardStatusCopy,
  liveBoardWindowLabel,
} from "./live-board-display-copy";

const SHIFTS: LiveBoardShiftRow[] = [
  { shift_key: "day", label: "Day", starts_at_local: "06:00:00", ends_at_local: "18:00:00" },
  { shift_key: "night", label: "Night", starts_at_local: "18:00:00", ends_at_local: "06:00:00" },
];

const WINDOWS: LiveBoardWindowRow[] = [
  {
    cadence_version_id: "v1",
    window_key: "mid_morning",
    label: "Mid morning check",
    shift_key: "day",
    due_at_utc: "2026-09-17T14:00:00Z",
    window_opens_at_utc: "2026-09-17T13:00:00Z",
    window_closes_at_utc: "2026-09-17T15:00:00Z",
  },
];

/** Every value of `resident_observation_task_status`, as of migration 098. */
const ALL_TASK_STATUSES = [
  "upcoming",
  "due_soon",
  "due_now",
  "overdue",
  "critically_overdue",
  "missed",
  "completed_on_time",
  "completed_late",
  "excused",
  "reassigned",
  "escalated",
] as const;

describe("Live board copy", () => {
  /**
   * Spec acceptance item 3: no raw enum value renders anywhere in the module.
   *
   * The test is that every label is sentence-case copy rather than a snake_case
   * identifier. `upcoming` is deliberately allowed to read as "Upcoming": that
   * is an English word which happens to also be the code, not the code leaking.
   */
  it("names every task status as copy rather than as an identifier", () => {
    for (const status of ALL_TASK_STATUSES) {
      const copy = liveBoardStatusCopy(status);
      expect(copy.label).not.toContain("_");
      expect(copy.label).toMatch(/^[A-Z]/);
      expect(copy.label).not.toBe(status);
    }
  });

  it("names the gap for a status it does not recognize, rather than printing it", () => {
    expect(liveBoardStatusCopy("some_new_status").label).toBe("No status posted");
    expect(liveBoardStatusCopy(null).label).toBe("No status posted");
  });

  /**
   * Spec decision D3 and defect 2. The shift label comes from a
   * `facility_shift_definitions` row, and a window whose shift has no row says
   * so rather than falling back to a shift name. There is no list of shifts in
   * the copy module to fall back to, which is the point.
   */
  it("reads shift labels from the facility's shift rows", () => {
    expect(liveBoardShiftLabel("day", SHIFTS)).toBe("Day shift");
    expect(liveBoardShiftLabel("night", SHIFTS)).toBe("Night shift");
  });

  it("refuses to name a shift the building does not run", () => {
    expect(liveBoardShiftLabel("evening", SHIFTS)).toBe("No shift posted");
    expect(liveBoardShiftLabel(null, SHIFTS)).toBe("No shift posted");
    expect(liveBoardShiftLabel("day", [])).toBe("No shift posted");
  });

  it("labels a window from the cadence version in force, and an order check as one", () => {
    expect(liveBoardWindowLabel("mid_morning", null, WINDOWS)).toBe("Mid morning check");
    expect(liveBoardWindowLabel(null, "order-1", WINDOWS)).toBe("Monitoring Order check");
    expect(liveBoardWindowLabel("retired_key", null, WINDOWS)).toBe("No window posted");
  });

  /** Spec decision D4: bands are words, and a rung key is not one of them. */
  it("names escalation rungs without rendering the rung key or its level", () => {
    expect(liveBoardRungLabel("nudge")).toBe("Staff reminder");
    expect(liveBoardRungLabel("tier_1")).toBe("First escalation");
    expect(liveBoardRungLabel("tier_3")).toBe("Terminal escalation");
    expect(liveBoardRungLabel("tier_9")).toBe("Escalated");
    expect(liveBoardRungLabel(null)).toBe("Escalated");
  });

  it("names the room gap rather than rendering an empty label", () => {
    expect(liveBoardRoomLabel("204B")).toBe("Room 204B");
    expect(liveBoardRoomLabel(null)).toBe("No room posted");
    expect(liveBoardRoomLabel("  ")).toBe("No room posted");
  });

  /**
   * The empty state never tells an operator to apply a cadence. The cadence is
   * configuration and it is in force at every building after migration 414, so
   * "Discovery cadence not configured" was both a dead end and false.
   */
  it("says what would populate the board, in two lines, without naming a cadence to apply", () => {
    const noFacility = liveBoardEmptyCopy({ hasFacility: false, rosterCount: 0, windowCount: 0 });
    expect(noFacility.why).toBe("No building selected.");

    const noRoster = liveBoardEmptyCopy({ hasFacility: true, rosterCount: 0, windowCount: 6 });
    expect(noRoster.guidance).toContain("active resident");

    const noWindows = liveBoardEmptyCopy({ hasFacility: true, rosterCount: 33, windowCount: 0 });
    expect(noWindows.why).toContain("No observation windows in force");

    const noTasks = liveBoardEmptyCopy({ hasFacility: true, rosterCount: 33, windowCount: 6 });
    expect(noTasks.guidance).toContain("generator");

    for (const copy of [noFacility, noRoster, noWindows, noTasks]) {
      expect(copy.why.length).toBeGreaterThan(0);
      expect(copy.guidance.length).toBeGreaterThan(0);
      expect(`${copy.why} ${copy.guidance}`).not.toMatch(/discovery cadence/i);
    }
  });

  it("explains the escalated filter's empty state in terms of what lands there", () => {
    expect(liveBoardFilterEmptyCopy("escalated").guidance).toContain("rung");
    expect(liveBoardFilterEmptyCopy("overdue").why).toBe("No checks match this filter.");
  });
});
