import { describe, expect, it } from "vitest";

import {
  DRILL_LOG_DRAFT_SAVED_COPY,
  DRILL_LOG_NO_RESIDENT_COUNT_COPY,
  DRILL_LOG_NO_STAFF_COUNT_COPY,
  formatDrillLogAttendanceLine,
  formatDrillLogResidentsPresentCount,
  formatDrillRecordState,
  formatDrillSaveProblem,
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

describe("formatDrillRecordState", () => {
  it("never lets a stored row imply a satisfied requirement", () => {
    expect(formatDrillRecordState({ finalized_at: null, voided_at: null })).toBe("draft — does not satisfy the requirement yet");
    expect(formatDrillRecordState({ finalized_at: "2026-09-13T18:00:00Z", voided_at: null })).toBe("final — delivered to its requirement");
  });

  it("reports a voided record as retained history even though it was once final", () => {
    expect(formatDrillRecordState({ finalized_at: "2026-09-13T18:00:00Z", voided_at: "2026-09-13T19:00:00Z" })).toBe("voided — retained history");
  });
});

describe("formatDrillSaveProblem", () => {
  it("repeats the lifecycle guard's answer and states that nothing was saved", () => {
    expect(formatDrillSaveProblem("Finalized drill logs change only through a correction")).toMatch(/already final.*nothing was saved here/i);
    expect(formatDrillSaveProblem("Voided drill logs are immutable")).toMatch(/retained history.*nothing was saved here/i);
    expect(formatDrillSaveProblem("Drill log finality changes only through the finalize, correct and void commands")).toMatch(/records a draft only.*nothing was saved here/i);
  });

  it("passes an unrecognised failure through instead of inventing a cause", () => {
    expect(formatDrillSaveProblem("network unreachable")).toBe("network unreachable");
  });

  it("tells a person what a saved drill did and did not do", () => {
    expect(DRILL_LOG_DRAFT_SAVED_COPY).toMatch(/draft/i);
    expect(DRILL_LOG_DRAFT_SAVED_COPY).toMatch(/does not satisfy its requirement yet/i);
    expect(DRILL_LOG_DRAFT_SAVED_COPY).toMatch(/finalizes it on the site work surface/i);
  });
});
