import { describe, expect, it } from "vitest";

import {
  residentDayWindowDates,
  summarizeResidentDayWindow,
  type CensusDayRow,
} from "./resident-days";

const FACILITIES = ["fac-a", "fac-b"];

/** One recorded census row per facility for each of `days` ending at `end`. */
function recordedDays(end: string, days: number, occupied: Record<string, number>): CensusDayRow[] {
  return residentDayWindowDates(end, days).flatMap((log_date) =>
    Object.entries(occupied).map(([facility_id, occupied_beds]) => ({
      facility_id,
      log_date,
      occupied_beds,
    })),
  );
}

describe("resident-day window", () => {
  it("spans the window inclusively, oldest day first", () => {
    const dates = residentDayWindowDates("2026-09-15", 30);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-08-17");
    expect(dates.at(-1)).toBe("2026-09-15");
  });

  it("counts a fully recorded window day by day, not from one day's census", () => {
    const window = summarizeResidentDayWindow({
      rows: recordedDays("2026-09-15", 30, { "fac-a": 20, "fac-b": 12 }),
      facilityIds: FACILITIES,
      endIsoDate: "2026-09-15",
    });

    expect(window.measuredDays).toBe(30);
    expect(window.windowDays).toBe(30);
    // 32 in census on each of 30 days, added up — not 32 × 30 assumed from one day.
    expect(window.residentDays).toBe(960);
    expect(window.startDate).toBe("2026-08-17");
    expect(window.endDate).toBe("2026-09-15");
    expect(window.facilityCount).toBe(2);
  });

  it("adds up only the days it has, and says how many that was", () => {
    // The job has been running for ten days; the twenty before it are absent.
    const window = summarizeResidentDayWindow({
      rows: recordedDays("2026-09-15", 10, { "fac-a": 20, "fac-b": 12 }),
      facilityIds: FACILITIES,
      endIsoDate: "2026-09-15",
    });

    expect(window.measuredDays).toBe(10);
    expect(window.residentDays).toBe(320);
  });

  it("does not count a day one facility missed", () => {
    const rows = recordedDays("2026-09-15", 30, { "fac-a": 20, "fac-b": 12 }).filter(
      (row) => !(row.log_date === "2026-09-14" && row.facility_id === "fac-b"),
    );

    const window = summarizeResidentDayWindow({
      rows,
      facilityIds: FACILITIES,
      endIsoDate: "2026-09-15",
    });

    // 29 whole days, and fac-a's 20 on the 14th is left out rather than added
    // to a day that is missing half its portfolio.
    expect(window.measuredDays).toBe(29);
    expect(window.residentDays).toBe(928);
  });

  it("ignores rows outside the window, outside the scope, or without a usable count", () => {
    const rows: CensusDayRow[] = [
      ...recordedDays("2026-09-15", 2, { "fac-a": 20, "fac-b": 12 }),
      // Before the window starts.
      { facility_id: "fac-a", log_date: "2026-07-01", occupied_beds: 99 },
      { facility_id: "fac-b", log_date: "2026-07-01", occupied_beds: 99 },
      // A facility that is not in scope for this page.
      { facility_id: "fac-z", log_date: "2026-09-15", occupied_beds: 99 },
      // A row that recorded no count is not a count of zero.
      { facility_id: "fac-a", log_date: "2026-09-13", occupied_beds: null },
      { facility_id: "fac-b", log_date: "2026-09-13", occupied_beds: 12 },
    ];

    const window = summarizeResidentDayWindow({
      rows,
      facilityIds: FACILITIES,
      endIsoDate: "2026-09-15",
    });

    expect(window.measuredDays).toBe(2);
    expect(window.residentDays).toBe(64);
  });

  it("measures nothing when no facility is in scope", () => {
    const window = summarizeResidentDayWindow({
      rows: recordedDays("2026-09-15", 30, { "fac-a": 20 }),
      facilityIds: [],
      endIsoDate: "2026-09-15",
    });

    expect(window.measuredDays).toBe(0);
    expect(window.residentDays).toBe(0);
    expect(window.facilityCount).toBe(0);
  });

  it("counts a recorded zero as a measured day", () => {
    const window = summarizeResidentDayWindow({
      rows: recordedDays("2026-09-15", 30, { "fac-a": 0, "fac-b": 0 }),
      facilityIds: FACILITIES,
      endIsoDate: "2026-09-15",
    });

    expect(window.measuredDays).toBe(30);
    expect(window.residentDays).toBe(0);
  });
});
