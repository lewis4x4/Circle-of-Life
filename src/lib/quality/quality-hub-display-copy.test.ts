import { describe, expect, it } from "vitest";

import {
  QUALITY_HUB_MEASURE_NAME_NOT_POSTED,
  QUALITY_HUB_NO_PERIOD_END_COPY,
  QUALITY_HUB_NO_PERIOD_START_COPY,
  QUALITY_HUB_NO_UNIT_COPY,
  QUALITY_HUB_NO_VALUE_COPY,
  QUALITY_HUB_ROW_COUNT_NOT_POSTED,
  QUALITY_HUB_NO_ORGANIZATION_METRIC_COPY,
  formatQualityHubMeasureName,
  formatQualityHubMeasureUnit,
  formatQualityHubPeriodEnd,
  formatQualityHubPeriodStart,
  formatQualityHubPbjRowCount,
  formatQualityHubResultValue,
  qualityHubMetricLoadingCopy,
  qualityHubMetricNoFacilityCopy,
  qualityHubMetricNoOrganizationCopy,
  qualityHubMetricValue,
} from "./quality-hub-display-copy";

const EM_DASH = "—";

describe("qualityHubMetricValue", () => {
  it("names the facility gap before loading or counts", () => {
    expect(qualityHubMetricValue(4, { noFacility: true, noOrganization: false, loading: false })).toBe(
      qualityHubMetricNoFacilityCopy(),
    );
  });

  it("names a loading gap before showing counts", () => {
    expect(qualityHubMetricValue(4, { noFacility: false, noOrganization: false, loading: true })).toBe(
      qualityHubMetricLoadingCopy(),
    );
  });

  it("names the organization gap before showing zero counts", () => {
    expect(
      qualityHubMetricValue(0, { noFacility: false, noOrganization: true, loading: false }),
    ).toBe(qualityHubMetricNoOrganizationCopy());
    expect(qualityHubMetricNoOrganizationCopy()).toBe(QUALITY_HUB_NO_ORGANIZATION_METRIC_COPY);
  });

  it("keeps real zeros once loaded", () => {
    expect(qualityHubMetricValue(0, { noFacility: false, noOrganization: false, loading: false })).toBe(0);
  });

  it("never returns an em dash", () => {
    const ctxs = [
      { noFacility: true, noOrganization: false, loading: false },
      { noFacility: false, noOrganization: true, loading: false },
      { noFacility: false, noOrganization: false, loading: true },
      { noFacility: false, noOrganization: false, loading: false },
    ];
    for (const ctx of ctxs) {
      const result = qualityHubMetricValue(3, ctx);
      expect(result).not.toBe(EM_DASH);
    }
  });
});

describe("formatQualityHubMeasureName", () => {
  it("names a missing measure name instead of an em dash or raw id", () => {
    expect(formatQualityHubMeasureName(null)).toBe(QUALITY_HUB_MEASURE_NAME_NOT_POSTED);
    expect(formatQualityHubMeasureName("")).toBe(QUALITY_HUB_MEASURE_NAME_NOT_POSTED);
    expect(formatQualityHubMeasureName("   ")).toBe(QUALITY_HUB_MEASURE_NAME_NOT_POSTED);
  });

  it("returns a posted name", () => {
    expect(formatQualityHubMeasureName("Pressure ulcer rate")).toBe("Pressure ulcer rate");
  });
});

describe("formatQualityHubMeasureUnit", () => {
  it("names a missing unit", () => {
    expect(formatQualityHubMeasureUnit(null)).toBe(QUALITY_HUB_NO_UNIT_COPY);
    expect(formatQualityHubMeasureUnit("")).toBe(QUALITY_HUB_NO_UNIT_COPY);
  });

  it("returns a posted unit", () => {
    expect(formatQualityHubMeasureUnit("%")).toBe("%");
  });
});

describe("formatQualityHubPeriodStart", () => {
  it("names a missing start date", () => {
    expect(formatQualityHubPeriodStart(null)).toBe(QUALITY_HUB_NO_PERIOD_START_COPY);
  });

  it("returns a posted start date", () => {
    expect(formatQualityHubPeriodStart("2026-01-01")).toBe("2026-01-01");
  });
});

describe("formatQualityHubPeriodEnd", () => {
  it("names a missing end date", () => {
    expect(formatQualityHubPeriodEnd(null)).toBe(QUALITY_HUB_NO_PERIOD_END_COPY);
  });

  it("returns a posted end date", () => {
    expect(formatQualityHubPeriodEnd("2026-03-31")).toBe("2026-03-31");
  });
});

describe("formatQualityHubResultValue", () => {
  it("keeps real numeric zero", () => {
    expect(formatQualityHubResultValue(0, null)).toBe("0");
  });

  it("prefers numeric values when present", () => {
    expect(formatQualityHubResultValue(12.5, "ignored")).toBe("12.5");
  });

  it("uses text when numeric is absent", () => {
    expect(formatQualityHubResultValue(null, "N/A")).toBe("N/A");
  });

  it("names a missing value", () => {
    expect(formatQualityHubResultValue(null, null)).toBe(QUALITY_HUB_NO_VALUE_COPY);
    expect(formatQualityHubResultValue(null, "")).toBe(QUALITY_HUB_NO_VALUE_COPY);
  });
});

describe("formatQualityHubPbjRowCount", () => {
  it("names a missing row count", () => {
    expect(formatQualityHubPbjRowCount(null)).toBe(QUALITY_HUB_ROW_COUNT_NOT_POSTED);
  });

  it("keeps real zero row counts", () => {
    expect(formatQualityHubPbjRowCount(0)).toBe("0");
  });

  it("formats positive counts", () => {
    expect(formatQualityHubPbjRowCount(42)).toBe("42");
  });
});
