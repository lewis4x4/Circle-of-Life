import { describe, expect, it } from "vitest";

import {
  FACILITY_OPERATOR_TZ,
  facilityDatetimeLocalToUtcIso,
  formatFacilityTimestampEt,
  nowFacilityDatetimeLocal,
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
});
