import { describe, expect, it } from "vitest";

import {
  BED_HOLD_EVENT_TYPES,
  REGISTER_EVENT_TYPES,
  filterRegisterRows,
  registerCountsLine,
  registerEventLabel,
  registerRoomLabel,
  residentStatusLabel,
  type RegisterRow,
} from "@/lib/registers/register";
import {
  easternDayEndIso,
  easternDayStartIso,
  formatCensusMonth,
  formatElapsedSince,
  isCompleteDateInput,
  monthsAgoEastern,
} from "@/lib/registers/register-display-copy";

function row(overrides: Partial<RegisterRow>): RegisterRow {
  return {
    eventAt: "2026-03-10T15:00:00Z",
    eventType: "admission",
    residentId: "resident-1",
    residentDisplayName: "Test Resident A",
    roomNumber: "101",
    bedLabel: "A",
    roomAsOf: "current",
    fromStatus: null,
    toStatus: "active",
    admissionSource: null,
    dischargeReason: null,
    dischargeDestination: null,
    recordedByName: "Review clerk",
    ...overrides,
  };
}

describe("register status labels", () => {
  it("names a held bed by why it is held, never as a level of care", () => {
    expect(residentStatusLabel("hospital_hold")).toBe("Bed Hold: Hospital");
    expect(residentStatusLabel("loa")).toBe("Bed Hold: Vacation/Family");
    for (const status of ["active", "hospital_hold", "loa", "discharged", "deceased"]) {
      expect(residentStatusLabel(status).toLowerCase()).not.toContain("memory care");
    }
  });

  it("leaves a missing from-status blank rather than inventing one", () => {
    expect(residentStatusLabel(null)).toBe("");
  });
});

describe("show bed holds", () => {
  it("hides exactly the four bed hold event types", () => {
    const rows = REGISTER_EVENT_TYPES.map((eventType) => row({ eventType }));
    const shown = filterRegisterRows(rows, false);
    expect(shown).toHaveLength(4);
    expect(shown.map((r) => r.eventType)).toEqual([
      "admission",
      "readmission",
      "discharge",
      "death",
    ]);
    expect(BED_HOLD_EVENT_TYPES).toHaveLength(4);
  });

  it("shows everything when bed holds are on", () => {
    const rows = REGISTER_EVENT_TYPES.map((eventType) => row({ eventType }));
    expect(filterRegisterRows(rows, true)).toHaveLength(REGISTER_EVENT_TYPES.length);
  });
});

describe("counts line", () => {
  it("counts what happened and names nothing that did not", () => {
    const rows = [
      row({ eventType: "admission" }),
      row({ eventType: "admission" }),
      row({ eventType: "admission" }),
      row({ eventType: "discharge" }),
      row({ eventType: "discharge" }),
      row({ eventType: "hospital_out" }),
    ];
    expect(registerCountsLine(rows)).toBe("Admissions 3 · Discharges 2 · Hospital out 1");
  });

  it("is empty for an empty range rather than a row of zeroes", () => {
    expect(registerCountsLine([])).toBe("");
  });
});

describe("event labels", () => {
  it("has operator wording for every event type", () => {
    for (const eventType of REGISTER_EVENT_TYPES) {
      const label = registerEventLabel(eventType);
      expect(label).toBeTruthy();
      expect(label).not.toContain("_");
    }
  });
});

describe("room", () => {
  it("joins room and bed, and says nothing when a discharged resident has no bed", () => {
    expect(registerRoomLabel({ roomNumber: "101", bedLabel: "A" })).toBe("101-A");
    expect(registerRoomLabel({ roomNumber: "101", bedLabel: null })).toBe("101");
    expect(registerRoomLabel({ roomNumber: null, bedLabel: null })).toBe("");
  });
});

describe("eastern day boundaries", () => {
  it("starts a winter day at 05:00 UTC and a summer day at 04:00 UTC", () => {
    expect(easternDayStartIso("2026-01-15")).toBe("2026-01-15T05:00:00.000Z");
    expect(easternDayStartIso("2026-07-15")).toBe("2026-07-15T04:00:00.000Z");
  });

  it("includes the chosen end date by ending at the start of the next day", () => {
    expect(easternDayEndIso("2026-01-15")).toBe("2026-01-16T05:00:00.000Z");
  });

  it("crosses the spring forward boundary without losing an hour", () => {
    expect(easternDayStartIso("2026-03-07")).toBe("2026-03-07T05:00:00.000Z");
    expect(easternDayStartIso("2026-03-09")).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("six month default", () => {
  it("clamps rather than overflowing a short month", () => {
    expect(monthsAgoEastern(6, new Date("2026-08-31T16:00:00Z"))).toBe("2026-02-28");
  });

  it("is the same day six months earlier when that day exists", () => {
    expect(monthsAgoEastern(6, new Date("2026-09-16T16:00:00Z"))).toBe("2026-03-16");
  });
});

describe("a half typed date", () => {
  it("is not a range to ask the database about", () => {
    expect(isCompleteDateInput("")).toBe(false);
    expect(isCompleteDateInput("2026-0")).toBe(false);
    expect(isCompleteDateInput("2026-13-01")).toBe(false);
    expect(isCompleteDateInput("2026-02-30")).toBe(false);
  });

  it("accepts a complete one", () => {
    expect(isCompleteDateInput("2026-03-16")).toBe(true);
    expect(isCompleteDateInput("2026-02-29")).toBe(false);
  });
});

describe("census month", () => {
  it("reads a month as the month it is, not the one before", () => {
    expect(formatCensusMonth("2026-03-01")).toBe("March 2026");
    expect(formatCensusMonth("2026-01-01")).toBe("January 2026");
  });
});

describe("elapsed", () => {
  it("counts how long a visitor has been in the building", () => {
    const now = new Date("2026-06-10T18:30:00Z");
    expect(formatElapsedSince("2026-06-10T18:10:00Z", now)).toBe("20 min");
    expect(formatElapsedSince("2026-06-10T16:30:00Z", now)).toBe("2 hr");
    expect(formatElapsedSince("2026-06-10T16:00:00Z", now)).toBe("2 hr 30 min");
  });
});

describe("COL-750: a back-dated register line says when it was entered", () => {
  it("names the entry time and reason only for a line staff dated back", async () => {
    const { formatRegisterEnteredNote } = await import("@/lib/registers/register-display-copy");
    expect(
      formatRegisterEnteredNote({
        eventAt: "2026-09-22T19:10:00Z",
        recordedAt: "2026-09-23T13:05:00Z",
        effectiveBasis: "entered",
        lateEntryReason: null,
      }),
    ).toBe("Entered Sep 23, 2026, 9:05 AM");
    expect(
      formatRegisterEnteredNote({
        eventAt: "2026-09-12T19:10:00Z",
        recordedAt: "2026-09-23T13:05:00Z",
        effectiveBasis: "entered",
        lateEntryReason: "Paper log",
      }),
    ).toBe("Entered Sep 23, 2026, 9:05 AM: Paper log");
    expect(formatRegisterEnteredNote({ eventAt: "2026-09-23T13:05:00Z", recordedAt: "2026-09-23T13:05:00Z", effectiveBasis: "save_time" })).toBeNull();
    expect(formatRegisterEnteredNote({ eventAt: "2026-09-23T13:05:00Z" })).toBeNull();
  });
});
