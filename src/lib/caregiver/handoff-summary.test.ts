import { describe, expect, it } from "vitest";

import {
  HANDOFF_NO_RESIDENT_COPY,
  autoSummaryCareEventLines,
  buildShiftHandoffAutoSummary,
  buildShiftHandoffInsert,
  currentShiftWindowFor,
  handoffSummaryLine,
  nextShift,
  residentInitialLast,
  shiftWindow,
  type HandoffCareEventInput,
} from "./handoff-summary";

const TIME_ZONE = "America/New_York";

function event(overrides: Partial<HandoffCareEventInput> = {}): HandoffCareEventInput {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "fall",
    final_level: "level_3",
    occurred_at: "2026-09-15T02:05:00.000Z", // 10:05 PM New York on Sep 14
    sentence: "Placeholder fell in the hallway.",
    resident: { first_name: "Placeholder", last_name: "Brownell" },
    room: "12",
    ...overrides,
  };
}

describe("buildShiftHandoffAutoSummary", () => {
  it("groups by level word in the order Emergency, Urgent, Heads-up, Note and skips empty levels", () => {
    const summary = buildShiftHandoffAutoSummary({
      careEvents: [
        event({ id: "n", final_level: "level_1", kind: "medication", occurred_at: "2026-09-14T20:00:00.000Z" }),
        event({ id: "e", final_level: "level_4", kind: "wandering", occurred_at: "2026-09-14T21:00:00.000Z" }),
        event({ id: "u", final_level: "level_3" }),
        event({ id: "h", final_level: "level_2", kind: "behavior", occurred_at: "2026-09-14T22:00:00.000Z" }),
      ],
      timeZone: TIME_ZONE,
      shift: "evening",
      date: "2026-09-14",
      now: new Date("2026-09-15T03:00:00.000Z"),
    });

    expect(summary.care_events.total).toBe(4);
    expect(summary.care_events.shift).toBe("evening");
    expect(summary.care_events.date).toBe("2026-09-14");
    expect(summary.care_events.generated_at).toBe("2026-09-15T03:00:00.000Z");
    expect(summary.care_events.by_level.map((group) => group.level_word)).toEqual(["Emergency", "Urgent", "Heads-up", "Note"]);
    expect(summary.care_events.by_level.map((group) => group.count)).toEqual([1, 1, 1, 1]);
    expect(summary.care_events.by_level[0].entries[0]).toEqual({
      care_event_id: "e",
      resident_initial_last: "P. Brownell",
      room: "12",
      tile_word: "Wandering or left",
      time_label: "5:00 PM",
      sentence: "Placeholder fell in the hallway.",
    });
    expect(JSON.stringify(summary)).not.toMatch(/level_[1-4]/);
  });

  it("prints one line per entry, numbered within the level", () => {
    const summary = buildShiftHandoffAutoSummary({
      careEvents: [
        event({ id: "a", final_level: "level_4" }),
        event({ id: "b", final_level: "level_4", kind: "condition_change", occurred_at: "2026-09-15T02:30:00.000Z", room: null }),
        event({ id: "c", final_level: "level_1", kind: "environment", resident: null, room: null }),
      ],
      timeZone: TIME_ZONE,
      shift: "evening",
      date: "2026-09-14",
    });

    expect(summary.lines).toEqual([
      "Emergency 1: P. Brownell, room 12, Fall at 10:05 PM",
      "Emergency 2: P. Brownell, Sick or not themselves at 10:30 PM",
      `Note 1: ${HANDOFF_NO_RESIDENT_COPY}, Building or other at 10:05 PM`,
    ]);
  });

  it("returns an empty summary for a quiet shift", () => {
    const summary = buildShiftHandoffAutoSummary({ careEvents: [], timeZone: TIME_ZONE, shift: "day", date: "2026-09-14" });
    expect(summary.care_events.total).toBe(0);
    expect(summary.care_events.by_level).toEqual([]);
    expect(summary.lines).toEqual([]);
  });

  it("orders entries within a level by time", () => {
    const summary = buildShiftHandoffAutoSummary({
      careEvents: [
        event({ id: "late", occurred_at: "2026-09-15T02:50:00.000Z" }),
        event({ id: "early", occurred_at: "2026-09-14T19:10:00.000Z" }),
      ],
      timeZone: TIME_ZONE,
      shift: "evening",
      date: "2026-09-14",
    });
    expect(summary.care_events.by_level[0].entries.map((entry) => entry.care_event_id)).toEqual(["early", "late"]);
  });
});

describe("handoffSummaryLine and residentInitialLast", () => {
  it("formats the line with and without a room", () => {
    const entry = {
      care_event_id: "x",
      resident_initial_last: "P. Brownell",
      room: "12",
      tile_word: "Fall",
      time_label: "10:05 PM",
      sentence: "",
    };
    expect(handoffSummaryLine("Urgent", 2, entry)).toBe("Urgent 2: P. Brownell, room 12, Fall at 10:05 PM");
    expect(handoffSummaryLine("Urgent", 2, { ...entry, room: null })).toBe("Urgent 2: P. Brownell, Fall at 10:05 PM");
  });

  it("abbreviates the first name and names a missing resident", () => {
    expect(residentInitialLast({ first_name: "Placeholder", last_name: "Brownell" })).toBe("P. Brownell");
    expect(residentInitialLast({ first_name: null, last_name: "Brownell" })).toBe("Brownell");
    expect(residentInitialLast({ first_name: "Placeholder", last_name: "" })).toBe("P.");
    expect(residentInitialLast(null)).toBe(HANDOFF_NO_RESIDENT_COPY);
  });
});

describe("shiftWindow", () => {
  it("bounds the day and evening shifts in the facility zone", () => {
    expect(shiftWindow("day", "2026-09-14", TIME_ZONE)).toEqual({
      startIso: "2026-09-14T11:00:00.000Z",
      endIso: "2026-09-14T19:00:00.000Z",
    });
    expect(shiftWindow("evening", "2026-09-14", TIME_ZONE)).toEqual({
      startIso: "2026-09-14T19:00:00.000Z",
      endIso: "2026-09-15T03:00:00.000Z",
    });
  });

  it("carries the night shift across midnight into the next day", () => {
    expect(shiftWindow("night", "2026-09-14", TIME_ZONE)).toEqual({
      startIso: "2026-09-15T03:00:00.000Z",
      endIso: "2026-09-15T11:00:00.000Z",
    });
  });

  it("respects standard time in December", () => {
    expect(shiftWindow("night", "2026-12-31", TIME_ZONE)).toEqual({
      startIso: "2027-01-01T04:00:00.000Z",
      endIso: "2027-01-01T12:00:00.000Z",
    });
  });
});

describe("currentShiftWindowFor", () => {
  it("names the shift on the floor and the date its window started", () => {
    expect(currentShiftWindowFor(TIME_ZONE, new Date("2026-09-14T13:00:00.000Z"))).toEqual({ shift: "day", date: "2026-09-14" });
    expect(currentShiftWindowFor(TIME_ZONE, new Date("2026-09-14T23:30:00.000Z"))).toEqual({ shift: "evening", date: "2026-09-14" });
    expect(currentShiftWindowFor(TIME_ZONE, new Date("2026-09-15T03:10:00.000Z"))).toEqual({ shift: "night", date: "2026-09-14" });
  });

  it("assigns the small hours to the night shift that started the day before", () => {
    expect(currentShiftWindowFor(TIME_ZONE, new Date("2026-09-15T05:30:00.000Z"))).toEqual({ shift: "night", date: "2026-09-14" });
    expect(currentShiftWindowFor(TIME_ZONE, new Date("2026-09-15T10:59:00.000Z"))).toEqual({ shift: "night", date: "2026-09-14" });
  });
});

describe("autoSummaryCareEventLines", () => {
  it("reads lines only when a care events object is present", () => {
    expect(autoSummaryCareEventLines({ care_events: { total: 1 }, lines: ["Urgent 1: P. Brownell, room 12, Fall at 10:05 PM", " ", 3] })).toEqual([
      "Urgent 1: P. Brownell, room 12, Fall at 10:05 PM",
    ]);
    expect(autoSummaryCareEventLines({ lines: ["stray"] })).toEqual([]);
    expect(autoSummaryCareEventLines({ care_events: { total: 0 } })).toEqual([]);
    expect(autoSummaryCareEventLines(null)).toEqual([]);
    expect(autoSummaryCareEventLines("text")).toEqual([]);
  });
});

describe("nextShift", () => {
  it("hands day to evening, evening to night, and night to day", () => {
    expect(nextShift("day")).toBe("evening");
    expect(nextShift("evening")).toBe("night");
    expect(nextShift("night")).toBe("day");
  });
});

describe("buildShiftHandoffInsert", () => {
  const input = {
    facilityId: "00000000-0000-4000-8000-0000000000f1",
    organizationId: "00000000-0000-4000-8000-0000000000a1",
    timeZone: TIME_ZONE,
    outgoingShift: "evening" as const,
    incomingShift: "night" as const,
    handoffDate: "2026-09-14",
    outgoingStaffId: "00000000-0000-4000-8000-0000000000c1",
    now: new Date("2026-09-15T03:00:00.000Z"),
  };

  it("writes the built summary as auto_summary and the trimmed note as outgoing_notes", () => {
    const row = buildShiftHandoffInsert({ ...input, outgoingNotes: "  Mrs. B asked for her daughter.  " }, [
      event({ id: "a", final_level: "level_2", kind: "behavior", occurred_at: "2026-09-14T22:00:00.000Z" }),
      event({ id: "b", final_level: "level_1", kind: "medication", occurred_at: "2026-09-14T20:00:00.000Z" }),
    ]);
    expect(row).toMatchObject({
      facility_id: input.facilityId,
      organization_id: input.organizationId,
      handoff_date: "2026-09-14",
      outgoing_shift: "evening",
      incoming_shift: "night",
      outgoing_staff_id: input.outgoingStaffId,
      outgoing_notes: "Mrs. B asked for her daughter.",
    });
    expect(row.auto_summary).toEqual(
      buildShiftHandoffAutoSummary({
        careEvents: [
          event({ id: "a", final_level: "level_2", kind: "behavior", occurred_at: "2026-09-14T22:00:00.000Z" }),
          event({ id: "b", final_level: "level_1", kind: "medication", occurred_at: "2026-09-14T20:00:00.000Z" }),
        ],
        timeZone: TIME_ZONE,
        shift: "evening",
        date: "2026-09-14",
        now: input.now,
      }),
    );
    expect(row.auto_summary.care_events.total).toBe(2);
    expect(row.auto_summary.lines).toEqual([
      "Heads-up 1: P. Brownell, room 12, Upset or behavior at 6:00 PM",
      "Note 1: P. Brownell, room 12, Medicine at 4:00 PM",
    ]);
    expect(autoSummaryCareEventLines(row.auto_summary)).toEqual(row.auto_summary.lines);
    expect(JSON.stringify(row)).not.toMatch(/level_[1-4]/);
  });

  it("stores null outgoing_notes for an empty or missing note and an empty summary for a quiet shift", () => {
    const blank = buildShiftHandoffInsert({ ...input, outgoingNotes: "   " }, []);
    expect(blank.outgoing_notes).toBeNull();
    expect(blank.auto_summary.care_events).toMatchObject({ total: 0, shift: "evening", date: "2026-09-14", by_level: [] });
    expect(blank.auto_summary.lines).toEqual([]);
    expect(buildShiftHandoffInsert(input, []).outgoing_notes).toBeNull();
  });

  it("keeps handoff_date as today while the summary covers the night window that started yesterday", () => {
    const row = buildShiftHandoffInsert(
      { ...input, outgoingShift: "night", incomingShift: "day", handoffDate: "2026-09-15", shiftDate: "2026-09-14" },
      [event({ id: "n", final_level: "level_1", occurred_at: "2026-09-15T06:00:00.000Z" })],
    );
    expect(row.handoff_date).toBe("2026-09-15");
    expect(row.auto_summary.care_events).toMatchObject({ shift: "night", date: "2026-09-14", total: 1 });
  });
});
