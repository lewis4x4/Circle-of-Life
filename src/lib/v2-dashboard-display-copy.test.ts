import { describe, expect, it } from "vitest";

import {
  V2_DASHBOARD_NO_FACILITY_COPY,
  V2_DASHBOARD_NO_VALUE_COPY,
  formatV2DashboardFacilityDisplay,
  formatV2DashboardMetric,
} from "./v2-dashboard-display-copy";

const EM_DASH = "—";

describe("formatV2DashboardFacilityDisplay", () => {
  it("names a missing facility instead of legacy Unnamed facility copy", () => {
    expect(formatV2DashboardFacilityDisplay(null)).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay(undefined)).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay(null)).not.toBe("Unnamed facility");
  });

  it("names a blank facility instead of legacy Unnamed facility copy", () => {
    expect(formatV2DashboardFacilityDisplay("")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay("   ")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay("")).not.toBe("Unnamed facility");
  });

  it("names an em dash facility instead of showing a silent dash", () => {
    expect(formatV2DashboardFacilityDisplay(EM_DASH)).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay(`  ${EM_DASH}  `)).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay(EM_DASH)).not.toBe(EM_DASH);
  });

  it("replaces legacy Unnamed facility copy with a named gap", () => {
    expect(formatV2DashboardFacilityDisplay("Unnamed facility")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay("  Unnamed facility  ")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
  });

  it("replaces legacy Unknown copy with a named gap", () => {
    expect(formatV2DashboardFacilityDisplay("Unknown")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
    expect(formatV2DashboardFacilityDisplay("  Unknown  ")).toBe(V2_DASHBOARD_NO_FACILITY_COPY);
  });

  it("returns a posted facility name trimmed", () => {
    expect(formatV2DashboardFacilityDisplay("Oakridge ALF")).toBe("Oakridge ALF");
    expect(formatV2DashboardFacilityDisplay("  Oakridge ALF  ")).toBe("Oakridge ALF");
  });
});

describe("formatV2DashboardMetric", () => {
  it("names a missing or non-finite metric instead of a silent dash", () => {
    expect(formatV2DashboardMetric(null)).toBe(V2_DASHBOARD_NO_VALUE_COPY);
    expect(formatV2DashboardMetric(undefined)).toBe(V2_DASHBOARD_NO_VALUE_COPY);
    expect(formatV2DashboardMetric(Number.NaN)).toBe(V2_DASHBOARD_NO_VALUE_COPY);
    expect(formatV2DashboardMetric(Number.POSITIVE_INFINITY)).toBe(V2_DASHBOARD_NO_VALUE_COPY);
    expect(formatV2DashboardMetric(null)).not.toBe(EM_DASH);
  });

  it("preserves posted integers including zero", () => {
    expect(formatV2DashboardMetric(0)).toBe("0");
    expect(formatV2DashboardMetric(12)).toBe("12");
  });

  it("formats fractional metrics to one decimal", () => {
    expect(formatV2DashboardMetric(12.34)).toBe("12.3");
  });
});
