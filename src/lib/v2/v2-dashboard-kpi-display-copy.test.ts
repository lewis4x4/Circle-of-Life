import { describe, expect, it } from "vitest";

import {
  V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY,
  V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL,
  V2_DASHBOARD_KPI_GAP_VALUES,
  isV2DashboardShellKpiGapValue,
} from "./v2-dashboard-kpi-display-copy";

const EM_DASH = "—";

const TWO_WAY_FAMILY_MARKERS = [
  "awaiting reply",
  "unread",
  "needs response",
  "inbox",
  "reply",
];

describe("V2 dashboard KPI shell gap copy", () => {
  it("does not use silent em-dash placeholders", () => {
    for (const gaps of Object.values(V2_DASHBOARD_KPI_GAP_VALUES)) {
      for (const gap of gaps) {
        expect(gap).not.toBe(EM_DASH);
        expect(gap).toMatch(/^No .+ posted( yet)?$/);
      }
    }
  });

  it("uses one-way family bulletin framing on command-center", () => {
    const commandCenterGaps = V2_DASHBOARD_KPI_GAP_VALUES["command-center"];
    const familyGap = commandCenterGaps[5];

    expect(V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL).toBe("Family portal notes");
    expect(familyGap).toBe(V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY);
    expect(familyGap).toBe("No bulletin notes posted yet");

    const familyCopy = `${V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL} ${familyGap}`.toLowerCase();
    for (const marker of TWO_WAY_FAMILY_MARKERS) {
      expect(familyCopy, `family KPI still mentions ${marker}`).not.toContain(marker);
    }
  });

  it("treats shell gap strings as empty KPI state", () => {
    expect(isV2DashboardShellKpiGapValue(V2_DASHBOARD_KPI_GAP_VALUES["command-center"][0])).toBe(true);
    expect(isV2DashboardShellKpiGapValue(null)).toBe(true);
    expect(isV2DashboardShellKpiGapValue("")).toBe(true);
    expect(isV2DashboardShellKpiGapValue(0)).toBe(false);
    expect(isV2DashboardShellKpiGapValue("12")).toBe(false);
    expect(isV2DashboardShellKpiGapValue(EM_DASH)).toBe(false);
  });
});
