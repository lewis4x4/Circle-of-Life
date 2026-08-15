import { describe, expect, it } from "vitest";

import {
  COVERAGE_NO_COMPLIANCE_CATEGORY_COPY,
  COVERAGE_NO_REFRESH_AGE_COPY,
  COVERAGE_REVIEW_NOT_OVERDUE_COPY,
  coverageKpiCoveragePctValue,
  coverageKpiEmptyCopy,
  coverageKpiOpenGapsValue,
  coverageKpiReviewOverdueValue,
  coverageKpiStaleExpiredValue,
  formatCoverageComplianceCategory,
  formatCoverageDaysSinceRefresh,
  formatCoverageReviewStatus,
  type CoverageKpiContext,
} from "./coverage-display-copy";

function ctx(partial: Partial<CoverageKpiContext> = {}): CoverageKpiContext {
  return {
    loadFailed: false,
    ...partial,
  };
}

describe("coverageKpiEmptyCopy", () => {
  it("names a failed rollup fetch", () => {
    expect(coverageKpiEmptyCopy("open_gaps", ctx({ loadFailed: true }))).toBe(
      "Knowledge counts did not load",
    );
  });

  it("names per-metric load gaps when rollup is absent", () => {
    expect(coverageKpiEmptyCopy("coverage_pct", ctx())).toBe("Coverage not loaded yet");
    expect(coverageKpiEmptyCopy("open_gaps", ctx())).toBe("Gap count not loaded yet");
    expect(coverageKpiEmptyCopy("stale_expired", ctx())).toBe("Stale count not loaded yet");
    expect(coverageKpiEmptyCopy("review_overdue_count", ctx())).toBe("Review count not loaded yet");
  });
});

describe("coverageKpiCoveragePctValue", () => {
  it("returns explicit copy when rollup is null", () => {
    expect(coverageKpiCoveragePctValue(null, ctx())).toBe("Coverage not loaded yet");
    expect(coverageKpiCoveragePctValue(null, ctx({ loadFailed: true }))).toBe(
      "Knowledge counts did not load",
    );
  });

  it("keeps real zero as 0%", () => {
    expect(coverageKpiCoveragePctValue({ coverage_pct: 0 }, ctx())).toBe("0%");
  });

  it("treats null pct as 0% when rollup exists", () => {
    expect(coverageKpiCoveragePctValue({ coverage_pct: null }, ctx())).toBe("0%");
  });

  it("returns loaded percentage unchanged", () => {
    expect(coverageKpiCoveragePctValue({ coverage_pct: 72 }, ctx())).toBe("72%");
  });
});

describe("coverageKpiOpenGapsValue", () => {
  it("returns explicit copy when rollup is null", () => {
    expect(coverageKpiOpenGapsValue(null, ctx())).toBe("Gap count not loaded yet");
  });

  it("keeps real zeros numeric", () => {
    expect(coverageKpiOpenGapsValue({ open_gaps: 0 }, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(coverageKpiOpenGapsValue({ open_gaps: 5 }, ctx())).toBe(5);
  });
});

describe("coverageKpiStaleExpiredValue", () => {
  it("returns explicit copy when rollup is null", () => {
    expect(coverageKpiStaleExpiredValue(null, ctx())).toBe("Stale count not loaded yet");
  });

  it("keeps real zeros numeric", () => {
    expect(coverageKpiStaleExpiredValue({ stale_documents: 0, expired_documents: 0 }, ctx())).toBe(0);
  });

  it("sums stale and expired counts", () => {
    expect(
      coverageKpiStaleExpiredValue({ stale_documents: 3, expired_documents: 2 }, ctx()),
    ).toBe(5);
  });
});

describe("coverageKpiReviewOverdueValue", () => {
  it("returns explicit copy when rollup is null", () => {
    expect(coverageKpiReviewOverdueValue(null, ctx())).toBe("Review count not loaded yet");
  });

  it("keeps real zeros numeric", () => {
    expect(coverageKpiReviewOverdueValue({ review_overdue_count: 0 }, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(coverageKpiReviewOverdueValue({ review_overdue_count: 4 }, ctx())).toBe(4);
  });
});

describe("formatCoverageComplianceCategory", () => {
  it("names missing category", () => {
    expect(formatCoverageComplianceCategory(null)).toBe(COVERAGE_NO_COMPLIANCE_CATEGORY_COPY);
    expect(formatCoverageComplianceCategory("")).toBe(COVERAGE_NO_COMPLIANCE_CATEGORY_COPY);
    expect(formatCoverageComplianceCategory("  ")).toBe(COVERAGE_NO_COMPLIANCE_CATEGORY_COPY);
  });

  it("returns posted category unchanged", () => {
    expect(formatCoverageComplianceCategory("HIPAA")).toBe("HIPAA");
  });
});

describe("formatCoverageDaysSinceRefresh", () => {
  it("names missing refresh age", () => {
    expect(formatCoverageDaysSinceRefresh(null)).toBe(COVERAGE_NO_REFRESH_AGE_COPY);
  });

  it("keeps real zero numeric", () => {
    expect(formatCoverageDaysSinceRefresh(0)).toBe(0);
  });

  it("returns posted age unchanged", () => {
    expect(formatCoverageDaysSinceRefresh(120)).toBe(120);
  });
});

describe("formatCoverageReviewStatus", () => {
  it("names not-overdue review state", () => {
    expect(formatCoverageReviewStatus(false)).toBe(COVERAGE_REVIEW_NOT_OVERDUE_COPY);
  });

  it("returns overdue label for overdue documents", () => {
    expect(formatCoverageReviewStatus(true)).toBe("Overdue");
  });
});
