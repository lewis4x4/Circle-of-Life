import { addMinutes, subMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  findWindowSatisfiedByObservation,
  nextShiftSpan,
  observationSatisfiesWindow,
  resolveObservationWindowsForDate,
  shiftSpanAt,
  windowsDuringShift,
  windowStartsItsShift,
  type ObservationCadenceWindow,
  type ObservationShiftDefinition,
} from "./observation-cadence";

const TZ = "America/New_York";
const CADENCE_VERSION_ID = "00000000-0000-0000-0003-000000000001";

/**
 * The rows migration 412 seeds. Times live here, in a fixture, because they are
 * configuration: the library under test must read them rather than know them.
 */
const SEEDED_SHIFTS: ObservationShiftDefinition[] = [
  { shiftKey: "day", label: "Day", startsAtLocal: "06:00", endsAtLocal: "18:00", sortOrder: 0 },
  { shiftKey: "night", label: "Night", startsAtLocal: "18:00", endsAtLocal: "06:00", sortOrder: 1 },
];

const SEEDED_WINDOWS: ObservationCadenceWindow[] = [
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "shift_change_am",
    label: "Morning shift change check",
    dueAtLocal: "06:00",
    graceBeforeMinutes: 0,
    graceAfterMinutes: 60,
    shiftKey: "day",
    sortOrder: 0,
    enabled: true,
  },
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "mid_morning",
    label: "Mid morning check",
    dueAtLocal: "10:00",
    graceBeforeMinutes: 60,
    graceAfterMinutes: 60,
    shiftKey: "day",
    sortOrder: 1,
    enabled: true,
  },
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "afternoon",
    label: "Afternoon check",
    dueAtLocal: "14:00",
    graceBeforeMinutes: 60,
    graceAfterMinutes: 60,
    shiftKey: "day",
    sortOrder: 2,
    enabled: true,
  },
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "shift_change_pm",
    label: "Night shift change check",
    dueAtLocal: "18:00",
    graceBeforeMinutes: 0,
    graceAfterMinutes: 60,
    shiftKey: "night",
    sortOrder: 3,
    enabled: true,
  },
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "late_evening",
    label: "Late evening check",
    dueAtLocal: "22:00",
    graceBeforeMinutes: 60,
    graceAfterMinutes: 60,
    shiftKey: "night",
    sortOrder: 4,
    enabled: true,
  },
  {
    cadenceVersionId: CADENCE_VERSION_ID,
    windowKey: "overnight",
    label: "Overnight check",
    dueAtLocal: "02:00",
    graceBeforeMinutes: 60,
    graceAfterMinutes: 60,
    shiftKey: "night",
    sortOrder: 5,
    enabled: true,
  },
];

const SERVICE_DATE = "2026-09-20";

function windowByKey(key: string) {
  const resolved = resolveObservationWindowsForDate(SEEDED_WINDOWS, SERVICE_DATE, TZ).find(
    (candidate) => candidate.windowKey === key,
  );
  if (!resolved) throw new Error(`No seeded window ${key}`);
  return resolved;
}

function configuredWindow(key: string) {
  const row = SEEDED_WINDOWS.find((candidate) => candidate.windowKey === key);
  if (!row) throw new Error(`No configured window ${key}`);
  return row;
}

function localClock(at: Date): string {
  return formatInTimeZone(at, TZ, "HH:mm");
}

describe("observation cadence windows read from configuration", () => {
  it("places every enabled window on the service date in configured order", () => {
    const resolved = resolveObservationWindowsForDate(SEEDED_WINDOWS, SERVICE_DATE, TZ);

    expect(resolved.map((window) => window.windowKey)).toEqual(
      SEEDED_WINDOWS.map((window) => window.windowKey),
    );
    expect(resolved.map((window) => localClock(window.dueAt))).toEqual(
      SEEDED_WINDOWS.map((window) => window.dueAtLocal),
    );
    expect(resolved.every((window) => window.cadenceVersionId === CADENCE_VERSION_ID)).toBe(true);
  });

  it("opens each window by its configured grace before and closes it by its grace after", () => {
    for (const row of SEEDED_WINDOWS) {
      const resolved = windowByKey(row.windowKey);
      expect(resolved.opensAt).toEqual(subMinutes(resolved.dueAt, row.graceBeforeMinutes));
      expect(resolved.closesAt).toEqual(addMinutes(resolved.dueAt, row.graceAfterMinutes));
    }
  });
});

/** Spec 25A acceptance item 2. */
describe("shift change grace is one sided", () => {
  it("refuses an observation recorded before the morning shift change window opens", () => {
    const shiftChangeAm = windowByKey("shift_change_am");
    expect(configuredWindow("shift_change_am").graceBeforeMinutes).toBe(0);

    const oneMinuteEarly = subMinutes(shiftChangeAm.dueAt, 1);
    expect(localClock(oneMinuteEarly) < configuredWindow("shift_change_am").dueAtLocal).toBe(true);
    expect(observationSatisfiesWindow(oneMinuteEarly, shiftChangeAm)).toBe(false);

    // The outgoing shift cannot clear the incoming shift's first look early, and
    // an early check does not fall through to some other window either.
    const allWindows = resolveObservationWindowsForDate(SEEDED_WINDOWS, SERVICE_DATE, TZ);
    expect(findWindowSatisfiedByObservation(oneMinuteEarly, allWindows)).toBeNull();
  });

  it("accepts an observation recorded at the due time of the morning shift change window", () => {
    const shiftChangeAm = windowByKey("shift_change_am");
    expect(observationSatisfiesWindow(shiftChangeAm.dueAt, shiftChangeAm)).toBe(true);
  });

  it("accepts a mid morning observation a full grace before its due time", () => {
    const row = configuredWindow("mid_morning");
    const midMorning = windowByKey("mid_morning");
    const earliestAccepted = subMinutes(midMorning.dueAt, row.graceBeforeMinutes);

    expect(row.graceBeforeMinutes).toBeGreaterThan(0);
    expect(localClock(earliestAccepted)).toBe("09:00");
    expect(observationSatisfiesWindow(earliestAccepted, midMorning)).toBe(true);
    expect(
      findWindowSatisfiedByObservation(
        earliestAccepted,
        resolveObservationWindowsForDate(SEEDED_WINDOWS, SERVICE_DATE, TZ),
      )?.windowKey,
    ).toBe("mid_morning");
  });

  it("refuses a mid morning observation one minute before its grace opens", () => {
    const row = configuredWindow("mid_morning");
    const midMorning = windowByKey("mid_morning");
    const tooEarly = subMinutes(midMorning.dueAt, row.graceBeforeMinutes + 1);

    expect(observationSatisfiesWindow(tooEarly, midMorning)).toBe(false);
  });

  it("marks only the windows whose due time is their own shift start", () => {
    const startsShift = SEEDED_WINDOWS.filter((window) => windowStartsItsShift(window, SEEDED_SHIFTS));
    expect(startsShift.map((window) => window.windowKey)).toEqual(["shift_change_am", "shift_change_pm"]);
    expect(startsShift.every((window) => window.graceBeforeMinutes === 0)).toBe(true);
  });
});

describe("two shift model", () => {
  it("resolves the shift in force and the shift that follows it", () => {
    const duringDay = new Date("2026-09-20T09:00:00-04:00");
    const current = shiftSpanAt(SEEDED_SHIFTS, duringDay, TZ);
    const next = nextShiftSpan(SEEDED_SHIFTS, duringDay, TZ);

    expect(current?.shiftKey).toBe("day");
    expect(next?.shiftKey).toBe("night");
    expect(next?.serviceDate).toBe("2026-09-20");
    expect(current?.endsAt).toEqual(next?.startsAt);
  });

  it("puts an instant after midnight on the night shift that started the evening before", () => {
    const afterMidnight = new Date("2026-09-20T03:00:00-04:00");
    const current = shiftSpanAt(SEEDED_SHIFTS, afterMidnight, TZ);

    expect(current?.shiftKey).toBe("night");
    expect(current?.serviceDate).toBe("2026-09-19");
    expect(nextShiftSpan(SEEDED_SHIFTS, afterMidnight, TZ)?.serviceDate).toBe("2026-09-20");
  });

  it("gives each shift three windows, with the overnight window on the later service date", () => {
    const duringDay = new Date("2026-09-20T09:00:00-04:00");
    const dayShift = shiftSpanAt(SEEDED_SHIFTS, duringDay, TZ)!;
    const nightShift = nextShiftSpan(SEEDED_SHIFTS, duringDay, TZ)!;

    const dayWindows = windowsDuringShift(SEEDED_WINDOWS, dayShift, TZ);
    const nightWindows = windowsDuringShift(SEEDED_WINDOWS, nightShift, TZ);

    expect(dayWindows.map((window) => window.windowKey)).toEqual([
      "shift_change_am",
      "mid_morning",
      "afternoon",
    ]);
    expect(nightWindows.map((window) => window.windowKey)).toEqual([
      "shift_change_pm",
      "late_evening",
      "overnight",
    ]);
    expect(nightWindows.map((window) => window.serviceDate)).toEqual([
      "2026-09-20",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(dayWindows.length + nightWindows.length).toBe(SEEDED_WINDOWS.length);
  });

  it("keeps the configured local clock times across the autumn daylight saving change", () => {
    const beforeTheChange = new Date("2026-10-31T12:00:00-04:00");
    const nightShift = nextShiftSpan(SEEDED_SHIFTS, beforeTheChange, TZ)!;
    const nightWindows = windowsDuringShift(SEEDED_WINDOWS, nightShift, TZ);

    expect(nightWindows.map((window) => localClock(window.dueAt))).toEqual(
      SEEDED_WINDOWS.filter((window) => window.shiftKey === "night").map((window) => window.dueAtLocal),
    );
    expect(nightWindows.at(-1)?.serviceDate).toBe("2026-11-01");
  });
});
