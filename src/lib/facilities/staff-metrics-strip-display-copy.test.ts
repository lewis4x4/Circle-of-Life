import { describe, expect, it } from "vitest";

import {
  STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY,
  STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY,
  formatStaffStripCoverageGapMainValue,
  staffStripCoverageGapMainIsNotTracked,
  staffStripCoverageGapMainIsNumeric,
} from "./staff-metrics-strip-display-copy";

const EM_DASH = "—";

describe("formatStaffStripCoverageGapMainValue", () => {
  it("names missing ratio configuration instead of an em dash", () => {
    expect(formatStaffStripCoverageGapMainValue(false, null)).toBe(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY);
    expect(formatStaffStripCoverageGapMainValue(false, undefined)).toBe(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY);
    expect(formatStaffStripCoverageGapMainValue(false, 0)).toBe(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY);
    expect(formatStaffStripCoverageGapMainValue(false, null)).not.toBe(EM_DASH);
  });

  it("names an uncomputed coverage gap when ratio rules are configured", () => {
    expect(formatStaffStripCoverageGapMainValue(true, null)).toBe(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY);
    expect(formatStaffStripCoverageGapMainValue(true, undefined)).toBe(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY);
    expect(formatStaffStripCoverageGapMainValue(true, null)).not.toBe(EM_DASH);
  });

  it("keeps a posted zero as numeric zero", () => {
    expect(formatStaffStripCoverageGapMainValue(true, 0)).toBe(0);
    expect(formatStaffStripCoverageGapMainValue(true, 0)).not.toBe(EM_DASH);
    expect(formatStaffStripCoverageGapMainValue(true, 0)).not.toBe(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY);
  });

  it("returns a posted gap count as a number", () => {
    expect(formatStaffStripCoverageGapMainValue(true, 3)).toBe(3);
    expect(formatStaffStripCoverageGapMainValue(true, 3)).not.toBe(EM_DASH);
  });

  it("never returns a silent em dash", () => {
    const cases = [
      formatStaffStripCoverageGapMainValue(false, null),
      formatStaffStripCoverageGapMainValue(false, undefined),
      formatStaffStripCoverageGapMainValue(true, null),
      formatStaffStripCoverageGapMainValue(true, undefined),
      formatStaffStripCoverageGapMainValue(true, 0),
      formatStaffStripCoverageGapMainValue(true, 2),
    ];
    for (const value of cases) {
      expect(value).not.toBe(EM_DASH);
    }
  });
});

describe("staffStripCoverageGapMainIsNotTracked", () => {
  it("flags the not-tracked copy", () => {
    expect(staffStripCoverageGapMainIsNotTracked(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY)).toBe(true);
    expect(staffStripCoverageGapMainIsNotTracked(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY)).toBe(false);
    expect(staffStripCoverageGapMainIsNotTracked(0)).toBe(false);
  });
});

describe("staffStripCoverageGapMainIsNumeric", () => {
  it("flags numeric main values only", () => {
    expect(staffStripCoverageGapMainIsNumeric(0)).toBe(true);
    expect(staffStripCoverageGapMainIsNumeric(4)).toBe(true);
    expect(staffStripCoverageGapMainIsNumeric(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY)).toBe(false);
    expect(staffStripCoverageGapMainIsNumeric(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY)).toBe(false);
  });
});
