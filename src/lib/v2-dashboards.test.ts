import { describe, expect, it } from "vitest";

import {
  V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY,
  V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL,
} from "./v2/v2-dashboard-kpi-display-copy";
import {
  V2_DASHBOARD_IDS,
  getV2DashboardPayload,
  isV2DashboardId,
  listV2DashboardIds,
} from "./v2-dashboards";

const EM_DASH = "—";

const TWO_WAY_FAMILY_MARKERS = [
  "awaiting reply",
  "unread",
  "needs response",
  "inbox",
  "reply to family",
];

describe("v2-dashboards live shell surface", () => {
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

  it("ships named Quiet Operator KPI gaps instead of silent em dashes", () => {
    for (const id of V2_DASHBOARD_IDS) {
      const payload = getV2DashboardPayload(id)!;
      expect(payload.tableRows).toEqual([]);
      expect(payload.alerts).toEqual([]);
      expect(payload.actionQueue).toEqual([]);

      for (const kpi of payload.kpis) {
        expect(kpi.value, `${id} KPI ${kpi.label}`).not.toBe(EM_DASH);
        expect(String(kpi.value), `${id} KPI ${kpi.label}`).toMatch(/^No .+ posted( yet)?$/);
      }
    }
  });

  it("frames the command-center family tile as one-way bulletin notes", () => {
    const payload = getV2DashboardPayload("command-center")!;
    const familyKpi = payload.kpis[5];

    expect(familyKpi.label).toBe(V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL);
    expect(familyKpi.value).toBe(V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY);

    const stripCopy = payload.kpis
      .flatMap((kpi) => [kpi.label, String(kpi.value)])
      .join(" ")
      .toLowerCase();

    for (const marker of TWO_WAY_FAMILY_MARKERS) {
      expect(stripCopy, `command-center strip still mentions ${marker}`).not.toContain(marker);
    }
  });

  it("returns null for unknown ids", () => {
    expect(getV2DashboardPayload("nope")).toBeNull();
    expect(getV2DashboardPayload("")).toBeNull();
  });
});
