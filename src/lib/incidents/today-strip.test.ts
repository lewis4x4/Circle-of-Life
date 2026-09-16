import { describe, expect, it } from "vitest";

import {
  ackQueueLine,
  ackWindowMinutes,
  ahcaClockLine,
  buildAckQueue,
  buildAhcaClocks,
  countEventsByLevel,
  levelCountLine,
  startOfTodayIso,
  type AckPolicyRow,
} from "./today-strip";

const NOW = Date.parse("2026-09-16T02:00:00.000Z"); // 10:00 PM Eastern on 9/15
const FACILITY = "fac-homewood";

const ORG_POLICIES: AckPolicyRow[] = [
  { facility_id: null, level: "level_2", step: 0, ack_within_minutes: 30 },
  { facility_id: null, level: "level_2", step: 1, ack_within_minutes: null },
  { facility_id: null, level: "level_3", step: 0, ack_within_minutes: 10 },
  { facility_id: null, level: "level_4", step: 0, ack_within_minutes: 5 },
];

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("ack window", () => {
  it("reads step 0 of the organization rows", () => {
    expect(ackWindowMinutes(2, FACILITY, ORG_POLICIES)).toBe(30);
    expect(ackWindowMinutes(3, FACILITY, ORG_POLICIES)).toBe(10);
    expect(ackWindowMinutes(1, FACILITY, ORG_POLICIES)).toBeNull();
  });

  it("lets facility rows override the organization set for that level", () => {
    const policies = [...ORG_POLICIES, { facility_id: FACILITY, level: "level_3", step: 0, ack_within_minutes: 15 }];
    expect(ackWindowMinutes(3, FACILITY, policies)).toBe(15);
    expect(ackWindowMinutes(2, FACILITY, policies)).toBe(30);
    expect(ackWindowMinutes(3, "another-facility", policies)).toBe(10);
  });
});

describe("acknowledgment queue", () => {
  it("counts open events past their window and reports the oldest age", () => {
    const queue = buildAckQueue(
      [
        { id: "a", final_level: "level_3", status: "open", created_at: minutesAgo(12) },
        { id: "b", final_level: "level_3", status: "open", created_at: minutesAgo(4) },
        { id: "c", final_level: "level_2", status: "open", created_at: minutesAgo(45) },
        { id: "d", final_level: "level_4", status: "acknowledged", created_at: minutesAgo(90) },
        { id: "e", final_level: "level_1", status: "open", created_at: minutesAgo(400) },
      ],
      ORG_POLICIES,
      FACILITY,
      NOW,
    );
    expect(queue).toEqual({ count: 2, oldestMinutes: 45, windowUnknown: false });
    expect(ackQueueLine(queue)).toBe("Oldest 45 min");
  });

  it("says when a level has no configured window instead of guessing", () => {
    const queue = buildAckQueue([{ id: "a", final_level: "level_3", status: "open", created_at: minutesAgo(50) }], [], FACILITY, NOW);
    expect(queue).toEqual({ count: 0, oldestMinutes: null, windowUnknown: true });
    expect(ackQueueLine(queue)).toBe("No acknowledgment window is configured");
    expect(ackQueueLine({ count: 0, oldestMinutes: null, windowUnknown: false })).toBe("Nothing waiting");
  });
});

describe("AHCA clocks", () => {
  it("finds the soonest open deadline and colors it", () => {
    const clocks = buildAhcaClocks(
      [
        { due_at: new Date(NOW + 5 * 3_600_000).toISOString(), submitted_at: null },
        { due_at: new Date(NOW + 300 * 3_600_000).toISOString(), submitted_at: null },
        { due_at: new Date(NOW - 3_600_000).toISOString(), submitted_at: "2026-09-15T00:00:00.000Z" },
      ],
      NOW,
    );
    expect(clocks.count).toBe(2);
    expect(clocks.soonestHours).toBeCloseTo(5, 5);
    expect(clocks.tone).toBe("warning");
    expect(ahcaClockLine(clocks)).toBe("Soonest in 5 h");
  });

  it("is red when past due and neutral with time to spare", () => {
    const late = buildAhcaClocks([{ due_at: new Date(NOW - 3 * 3_600_000).toISOString(), submitted_at: null }], NOW);
    expect(late.tone).toBe("destructive");
    expect(ahcaClockLine(late)).toBe("Past due by 3 h");
    const calm = buildAhcaClocks([{ due_at: new Date(NOW + 72 * 3_600_000).toISOString(), submitted_at: null }], NOW);
    expect(calm.tone).toBe("neutral");
    expect(ahcaClockLine(calm)).toBe("Soonest in 72 h");
    const minutes = buildAhcaClocks([{ due_at: new Date(NOW + 20 * 60_000).toISOString(), submitted_at: null }], NOW);
    expect(ahcaClockLine(minutes)).toBe("Soonest in 20 min");
    expect(ahcaClockLine(buildAhcaClocks([], NOW))).toBe("No open clocks");
  });
});

describe("events today by level", () => {
  it("counts by level word and skips unknown levels", () => {
    const counts = countEventsByLevel([
      { final_level: "level_1" },
      { final_level: "level_1" },
      { final_level: "level_1" },
      { final_level: "level_2" },
      { final_level: "nope" },
    ]);
    expect(counts).toEqual({ 1: 3, 2: 1, 3: 0, 4: 0 });
    expect(levelCountLine(counts)).toBe("Note 3, Heads-up 1, Urgent 0, Emergency 0");
  });
});

describe("start of today", () => {
  it("returns local midnight in the facility timezone as a UTC instant", () => {
    // 10:00 PM Eastern on 9/15 is still 9/15 locally; midnight EDT is 04:00Z.
    expect(startOfTodayIso(NOW, "America/New_York")).toBe("2026-09-15T04:00:00.000Z");
    expect(startOfTodayIso(NOW, "UTC")).toBe("2026-09-16T00:00:00.000Z");
  });
});
