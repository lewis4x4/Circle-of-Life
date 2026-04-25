import { describe, expect, it } from "vitest";

import {
  V2_DASHBOARD_IDS,
  getV2DashboardPayload,
  isV2DashboardId,
  listV2DashboardIds,
} from "./v2-dashboards";

describe("v2-dashboards fixture surface", () => {
  it("exports the four W1 dashboard ids in canonical order", () => {
    expect(listV2DashboardIds()).toEqual([
      "command-center",
      "executive-intelligence",
      "clinical-quality",
      "rounding-operations",
    ]);
  });

  it("isV2DashboardId narrows correctly", () => {
    expect(isV2DashboardId("command-center")).toBe(true);
    expect(isV2DashboardId("clinical-quality")).toBe(true);
    expect(isV2DashboardId("nope")).toBe(false);
    expect(isV2DashboardId("")).toBe(false);
  });

  it("returns a payload with exactly 6 KPIs and 4 panels per dashboard", () => {
    for (const id of V2_DASHBOARD_IDS) {
      const payload = getV2DashboardPayload(id);
      expect(payload).not.toBeNull();
      expect(payload!.kpis).toHaveLength(6);
      expect(payload!.panels).toHaveLength(4);
      expect(payload!.id).toBe(id);
      expect(payload!.title).toBeTruthy();
    }
  });

  it("table rows share the canonical facility shape", () => {
    const payload = getV2DashboardPayload("command-center")!;
    for (const row of payload.tableRows) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.occupancyPct).toBe("number");
      expect(typeof row.laborCostPct).toBe("number");
      expect(typeof row.openIncidents).toBe("number");
      expect(typeof row.surveyReadinessPct).toBe("number");
    }
  });

  it("returns null for unknown ids", () => {
    expect(getV2DashboardPayload("nope")).toBeNull();
    expect(getV2DashboardPayload("")).toBeNull();
  });
});
