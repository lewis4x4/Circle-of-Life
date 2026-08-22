import { describe, expect, it } from "vitest";

import {
  STAFF_STRIP_ACTIVE_STAFF_SUBCOPY,
  STAFF_STRIP_BG_CHECKS_CLEAR_SUBCOPY,
  STAFF_STRIP_BG_CHECKS_RENEW_SUBCOPY,
  STAFF_STRIP_CERTS_SUBCOPY,
  STAFF_STRIP_COVERAGE_CONFIGURE_RATIO_SUBCOPY,
  STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY,
  STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY,
  STAFF_STRIP_COVERAGE_POSTED_COUNT_SUBCOPY,
  STAFF_STRIP_COVERAGE_POSTED_ZERO_SUBCOPY,
  formatStaffStripCoverageGapMainValue,
  formatStaffStripCoverageGapSubcopy,
  staffStripCoverageGapMainIsNotComputed,
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
    expect(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY).toMatch(/^No .+ posted yet$/);
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

describe("staffStripCoverageGapMainIsNotComputed", () => {
  it("flags the not-computed copy", () => {
    expect(staffStripCoverageGapMainIsNotComputed(STAFF_STRIP_COVERAGE_NOT_COMPUTED_COPY)).toBe(true);
    expect(staffStripCoverageGapMainIsNotComputed(STAFF_STRIP_COVERAGE_NOT_TRACKED_COPY)).toBe(false);
    expect(staffStripCoverageGapMainIsNotComputed(0)).toBe(false);
  });
});

describe("formatStaffStripCoverageGapSubcopy", () => {
  it("keeps the configure-ratio path when ratio rules are missing", () => {
    expect(formatStaffStripCoverageGapSubcopy(false, null)).toBe(STAFF_STRIP_COVERAGE_CONFIGURE_RATIO_SUBCOPY);
    expect(formatStaffStripCoverageGapSubcopy(false, 0)).toBe(STAFF_STRIP_COVERAGE_CONFIGURE_RATIO_SUBCOPY);
  });

  it("omits subtitle when ratio is ready but coverage counts are not posted", () => {
    expect(formatStaffStripCoverageGapSubcopy(true, null)).toBeNull();
    expect(formatStaffStripCoverageGapSubcopy(true, undefined)).toBeNull();
  });

  it("names a posted zero without inventing a gap count", () => {
    expect(formatStaffStripCoverageGapSubcopy(true, 0)).toBe(STAFF_STRIP_COVERAGE_POSTED_ZERO_SUBCOPY);
  });

  it("names a posted non-zero count without sprint jargon", () => {
    expect(formatStaffStripCoverageGapSubcopy(true, 2)).toBe(STAFF_STRIP_COVERAGE_POSTED_COUNT_SUBCOPY);
    expect(formatStaffStripCoverageGapSubcopy(true, 2)).not.toMatch(/sprint|engine/i);
  });
});

describe("STAFF_STRIP_ACTIVE_STAFF_SUBCOPY", () => {
  it("reads as unique people rather than raw row counts", () => {
    expect(STAFF_STRIP_ACTIVE_STAFF_SUBCOPY.toLowerCase()).toContain("unique");
    expect(STAFF_STRIP_ACTIVE_STAFF_SUBCOPY.toLowerCase()).toContain("people");
  });
});

describe("STAFF_STRIP_CERTS_SUBCOPY", () => {
  it("names the 30-day expiring window for operator clarity", () => {
    expect(STAFF_STRIP_CERTS_SUBCOPY).toContain("30 days");
    expect(STAFF_STRIP_CERTS_SUBCOPY.toLowerCase()).toContain("facility scope");
  });
});

describe("STAFF_STRIP_BG_CHECKS_*_SUBCOPY", () => {
  it("names the 30-day window instead of a vague in-window phrase", () => {
    expect(STAFF_STRIP_BG_CHECKS_CLEAR_SUBCOPY).toContain("30 days");
    expect(STAFF_STRIP_BG_CHECKS_RENEW_SUBCOPY).toContain("30 days");
    expect(STAFF_STRIP_BG_CHECKS_CLEAR_SUBCOPY).not.toMatch(/in window/i);
  });
});
