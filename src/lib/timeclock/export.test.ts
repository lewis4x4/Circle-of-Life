import { describe, expect, it } from "vitest";

import { computeTimesheet, facilityDayStart, type RawCorrection, type RawPunch } from "./compute";
import { buildTimecardCsv, buildTimecardRows, exportGate, inclusivePeriodEnd, timecardFilename } from "./export";

const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function punch(id: string, punch_type: RawPunch["punch_type"], iso: string, flags: string[] = []): RawPunch {
  return { id, staff_id: STAFF, punch_type, punched_at: iso, flags };
}

describe("timecard export", () => {
  it("names the file after the facility slug and period start", () => {
    expect(timecardFilename("Homewood Lodge, ALF", "2026-11-02")).toBe("haven-timecard-homewood-lodge-alf-2026-11-02.csv");
    expect(inclusivePeriodEnd("2026-11-16")).toBe("2026-11-15");
  });

  it("writes one row per staff per workweek with integer minutes and exception counts", () => {
    const periodStart = facilityDayStart("2026-11-02");
    const periodEnd = facilityDayStart("2026-11-16");
    const punches = [
      punch("p1", "in", "2026-11-02T12:00:00.000Z", ["clock_skew"]),
      punch("p2", "out", "2026-11-02T20:00:00.000Z"),
      punch("p3", "in", "2026-11-10T12:00:00.000Z"),
      punch("p4", "out", "2026-11-10T22:01:00.000Z"),
    ];
    const corrections: RawCorrection[] = [
      { id: "c1", staff_id: STAFF, correction_type: "acknowledge", target_punch_id: null, target_correction_id: null, punch_type: null, corrected_punched_at: null, exception_key: "clock_skew:p1", reason: "manager_verified_time", note: null, corrected_by: "m", corrected_at: "2026-11-03T00:00:00.000Z" },
    ];
    const sheet = computeTimesheet({ staffId: STAFF, punches, corrections, periodStart, periodEnd, now: new Date("2026-11-17T12:00:00.000Z") });
    const rows = buildTimecardRows({ periodStartIso: "2026-11-02", periodEndIso: "2026-11-16", staff: [{ staffId: STAFF, name: "Test Staff A", employeeNumber: "A-100", sheet }] });
    expect(rows).toEqual([
      { employee_number: "A-100", staff_name: "Test Staff A", period_start: "2026-11-02", period_end: "2026-11-15", workweek_start: "2026-11-02", regular_minutes: "480", overtime_minutes: "0", meal_minutes: "0", exception_count: "1", unapproved_exceptions: "0" },
      { employee_number: "A-100", staff_name: "Test Staff A", period_start: "2026-11-02", period_end: "2026-11-15", workweek_start: "2026-11-09", regular_minutes: "601", overtime_minutes: "0", meal_minutes: "0", exception_count: "0", unapproved_exceptions: "0" },
    ]);
    const csv = buildTimecardCsv(rows);
    expect(csv.split("\r\n")[0]).toBe("employee_number,staff_name,period_start,period_end,workweek_start,regular_minutes,overtime_minutes,meal_minutes,exception_count,unapproved_exceptions");
    expect(csv).toContain("A-100,Test Staff A,2026-11-02,2026-11-15,2026-11-02,480,0,0,1,0");
  });

  it("blocks export until the pay period is set and every exception is acknowledged", () => {
    expect(exportGate({ payPeriodSet: false, unresolvedExceptions: 0 })).toMatchObject({ blocked: true, code: "pay_period_unset", reason: "Set the pay period to export" });
    expect(exportGate({ payPeriodSet: true, unresolvedExceptions: 3 })).toMatchObject({ blocked: true, code: "open_exceptions", reason: "Resolve 3 exceptions to export" });
    expect(exportGate({ payPeriodSet: true, unresolvedExceptions: 0 })).toEqual({ blocked: false });
  });
});
