import { describe, expect, it } from "vitest";

import {
  DRILL_LOG_NO_RESIDENT_COUNT_COPY,
  DRILL_LOG_NO_STAFF_COUNT_COPY,
  formatDrillLogAttendanceLine,
  formatDrillLogResidentsPresentCount,
  formatDrillLogStaffPresentCount,
} from "./emergency-preparedness-display-copy";

describe("formatDrillLogStaffPresentCount", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatDrillLogStaffPresentCount(null)).toBe(DRILL_LOG_NO_STAFF_COUNT_COPY);
    expect(formatDrillLogStaffPresentCount(undefined)).toBe(DRILL_LOG_NO_STAFF_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatDrillLogStaffPresentCount(0)).toBe(0);
  });

  it("returns posted counts unchanged", () => {
    expect(formatDrillLogStaffPresentCount(12)).toBe(12);
  });
});

describe("formatDrillLogResidentsPresentCount", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatDrillLogResidentsPresentCount(null)).toBe(DRILL_LOG_NO_RESIDENT_COUNT_COPY);
    expect(formatDrillLogResidentsPresentCount(undefined)).toBe(DRILL_LOG_NO_RESIDENT_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatDrillLogResidentsPresentCount(0)).toBe(0);
  });

  it("returns posted counts unchanged", () => {
    expect(formatDrillLogResidentsPresentCount(38)).toBe(38);
  });
});

describe("formatDrillLogAttendanceLine", () => {
  it("names gaps for missing staff and resident counts", () => {
    expect(formatDrillLogAttendanceLine(null, null)).toBe(
      `staff ${DRILL_LOG_NO_STAFF_COUNT_COPY} / residents ${DRILL_LOG_NO_RESIDENT_COUNT_COPY}`,
    );
  });

  it("keeps real zeros and mixes posted counts with gaps", () => {
    expect(formatDrillLogAttendanceLine(0, 5)).toBe("staff 0 / residents 5");
    expect(formatDrillLogAttendanceLine(3, null)).toBe(
      `staff 3 / residents ${DRILL_LOG_NO_RESIDENT_COUNT_COPY}`,
    );
    expect(formatDrillLogAttendanceLine(null, 0)).toBe(
      `staff ${DRILL_LOG_NO_STAFF_COUNT_COPY} / residents 0`,
    );
  });
});
