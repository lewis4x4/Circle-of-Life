import { describe, expect, it } from "vitest";

import {
  V2_DASHBOARD_NO_FACILITY_COPY,
  formatV2DashboardFacilityDisplay,
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
