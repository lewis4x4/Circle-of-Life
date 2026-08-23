import { describe, expect, it } from "vitest";

import {
  FACILITY_OPERATOR_TZ,
  addFacilityCalendarDays,
  facilityDateIsoDaysFromToday,
  facilityDatetimeLocalToUtcIso,
  formatFacilityTimestampEt,
  nowFacilityDatetimeLocal,
  todayFacilityDateIso,
  utcIsoToFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";

describe("facility wall clock (America/New_York)", () => {
  /** 4:06 PM Eastern on 2026-08-20 (EDT, UTC−4). */
  const fourOhSixPmEt = new Date("2026-08-20T20:06:00.000Z");

  it("defaults datetime-local to Eastern wall clock, not UTC ISO slice", () => {
    expect(nowFacilityDatetimeLocal(fourOhSixPmEt)).toBe("2026-08-20T16:06");
    expect(nowFacilityDatetimeLocal(fourOhSixPmEt)).not.toBe("2026-08-20T20:06");
    expect(fourOhSixPmEt.toISOString().slice(0, 16)).toBe("2026-08-20T20:06");
  });

  it("persists Eastern datetime-local without a 4-hour shift", () => {
    expect(facilityDatetimeLocalToUtcIso("2026-08-20T16:06")).toBe("2026-08-20T20:06:00.000Z");
  });

  it("hydrates datetime-local from stored UTC ISO in Eastern wall clock, not UTC ISO slice", () => {
    expect(utcIsoToFacilityDatetimeLocal("2026-08-20T20:06:00.000Z")).toBe("2026-08-20T16:06");
    expect(utcIsoToFacilityDatetimeLocal("2026-08-20T20:06:00.000Z")).not.toBe("2026-08-20T20:06");
    expect(fourOhSixPmEt.toISOString().slice(0, 16)).toBe("2026-08-20T20:06");
  });

  it("formats stored timestamps in Eastern with operator-friendly copy", () => {
    expect(formatFacilityTimestampEt("2026-08-20T20:06:00.000Z")).toMatch(/Aug 20.*4:06/i);
  });

  it("anchors to COL facility timezone constant", () => {
    expect(FACILITY_OPERATOR_TZ).toBe("America/New_York");
  });

  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("defaults date-only today to Eastern calendar date, not UTC ISO slice", () => {
    expect(todayFacilityDateIso(eightOhFivePmEt)).toBe("2026-08-20");
    expect(todayFacilityDateIso(eightOhFivePmEt)).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("offsets date-only windows on the Eastern calendar", () => {
    expect(facilityDateIsoDaysFromToday(1, eightOhFivePmEt)).toBe("2026-08-21");
    expect(facilityDateIsoDaysFromToday(2, eightOhFivePmEt)).toBe("2026-08-22");
    expect(addFacilityCalendarDays(todayFacilityDateIso(eightOhFivePmEt), 30)).toBe("2026-09-19");
  });
});
