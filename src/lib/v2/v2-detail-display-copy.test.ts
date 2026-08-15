import { describe, expect, it } from "vitest";

import {
  V2_DETAIL_NO_CATEGORY_POSTED_COPY,
  V2_DETAIL_NO_DATE_POSTED_COPY,
  V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY,
  V2_DETAIL_NO_METRIC_POSTED_COPY,
  V2_DETAIL_NO_SEVERITY_POSTED_COPY,
  formatV2DetailCategory,
  formatV2DetailDate,
  formatV2DetailDiagnosis,
  formatV2DetailSeverity,
  formatV2DetailSourceMetric,
} from "./v2-detail-display-copy";

const EM_DASH = "—";

describe("formatV2DetailDiagnosis", () => {
  it("names the gap when diagnosis is missing", () => {
    expect(formatV2DetailDiagnosis(null)).toBe(V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY);
    expect(formatV2DetailDiagnosis(undefined)).toBe(V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY);
  });

  it("names the gap when diagnosis is blank", () => {
    expect(formatV2DetailDiagnosis("")).toBe(V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY);
    expect(formatV2DetailDiagnosis("   ")).toBe(V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY);
  });

  it("keeps posted diagnosis trimmed as-is", () => {
    expect(formatV2DetailDiagnosis("Fall risk")).toBe("Fall risk");
    expect(formatV2DetailDiagnosis("  Fall risk  ")).toBe("Fall risk");
  });
});

describe("formatV2DetailSeverity", () => {
  it("names the gap when severity is missing", () => {
    expect(formatV2DetailSeverity(null)).toBe(V2_DETAIL_NO_SEVERITY_POSTED_COPY);
    expect(formatV2DetailSeverity(undefined)).toBe(V2_DETAIL_NO_SEVERITY_POSTED_COPY);
  });

  it("names the gap when severity is blank", () => {
    expect(formatV2DetailSeverity("")).toBe(V2_DETAIL_NO_SEVERITY_POSTED_COPY);
    expect(formatV2DetailSeverity("   ")).toBe(V2_DETAIL_NO_SEVERITY_POSTED_COPY);
  });

  it("keeps posted severity trimmed as-is", () => {
    expect(formatV2DetailSeverity("moderate")).toBe("moderate");
    expect(formatV2DetailSeverity("  moderate  ")).toBe("moderate");
  });
});

describe("formatV2DetailCategory", () => {
  it("names the gap when category is missing", () => {
    expect(formatV2DetailCategory(null)).toBe(V2_DETAIL_NO_CATEGORY_POSTED_COPY);
    expect(formatV2DetailCategory(undefined)).toBe(V2_DETAIL_NO_CATEGORY_POSTED_COPY);
  });

  it("names the gap when category is blank", () => {
    expect(formatV2DetailCategory("")).toBe(V2_DETAIL_NO_CATEGORY_POSTED_COPY);
    expect(formatV2DetailCategory("   ")).toBe(V2_DETAIL_NO_CATEGORY_POSTED_COPY);
  });

  it("keeps posted category trimmed as-is", () => {
    expect(formatV2DetailCategory("Fall")).toBe("Fall");
    expect(formatV2DetailCategory("  Fall  ")).toBe("Fall");
  });
});

describe("formatV2DetailDate", () => {
  it("names the gap when date is missing", () => {
    expect(formatV2DetailDate(null)).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
    expect(formatV2DetailDate(undefined)).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
    expect(formatV2DetailDate(null)).not.toBe(EM_DASH);
  });

  it("names the gap when date is blank", () => {
    expect(formatV2DetailDate("")).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
    expect(formatV2DetailDate("   ")).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
    expect(formatV2DetailDate("—")).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
  });

  it("names the gap when date is invalid", () => {
    expect(formatV2DetailDate("not-a-date")).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
    expect(formatV2DetailDate("2026-13-40")).toBe(V2_DETAIL_NO_DATE_POSTED_COPY);
  });

  it("keeps posted dates in the existing v2 detail shape", () => {
    expect(formatV2DetailDate("2026-03-15")).toBe("2026-03-15");
    expect(formatV2DetailDate("2026-03-15T14:30:00Z")).toBe("2026-03-15 14:30");
  });
});

describe("formatV2DetailSourceMetric", () => {
  it("names the gap when source metric is missing", () => {
    expect(formatV2DetailSourceMetric(null)).toBe(V2_DETAIL_NO_METRIC_POSTED_COPY);
    expect(formatV2DetailSourceMetric(undefined)).toBe(V2_DETAIL_NO_METRIC_POSTED_COPY);
  });

  it("names the gap when source metric is blank", () => {
    expect(formatV2DetailSourceMetric("")).toBe(V2_DETAIL_NO_METRIC_POSTED_COPY);
    expect(formatV2DetailSourceMetric("   ")).toBe(V2_DETAIL_NO_METRIC_POSTED_COPY);
  });

  it("keeps posted source metric trimmed as-is", () => {
    expect(formatV2DetailSourceMetric("fall_rate_7d")).toBe("fall_rate_7d");
    expect(formatV2DetailSourceMetric("  fall_rate_7d  ")).toBe("fall_rate_7d");
  });
});
