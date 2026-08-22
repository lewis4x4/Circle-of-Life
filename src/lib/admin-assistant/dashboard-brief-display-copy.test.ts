import { describe, expect, it } from "vitest";

import {
  adminAssistantDashboardKpiTileIsMetric,
  formatAdminAssistantDashboardKpiValue,
} from "./dashboard-brief-display-copy";

describe("formatAdminAssistantDashboardKpiValue", () => {
  it("returns named loading copy per tile", () => {
    expect(formatAdminAssistantDashboardKpiValue("census", 0, true)).toBe(
      "Loading census count…",
    );
    expect(formatAdminAssistantDashboardKpiValue("pending_docs", 3, true)).toBe(
      "Loading pending docs…",
    );
    expect(formatAdminAssistantDashboardKpiValue("staff_bulletin_notes", null, true)).toBe(
      "Loading bulletin notes…",
    );
    expect(formatAdminAssistantDashboardKpiValue("transportation_today", undefined, true)).toBe(
      "Loading transport count…",
    );
  });

  it("keeps real zero as numeric zero when loaded", () => {
    expect(formatAdminAssistantDashboardKpiValue("census", 0, false)).toBe(0);
    expect(formatAdminAssistantDashboardKpiValue("pending_docs", 0, false)).toBe(0);
    expect(formatAdminAssistantDashboardKpiValue("staff_bulletin_notes", 0, false)).toBe(0);
    expect(formatAdminAssistantDashboardKpiValue("transportation_today", 0, false)).toBe(0);
  });

  it("returns posted positive counts unchanged", () => {
    expect(formatAdminAssistantDashboardKpiValue("census", 42, false)).toBe(42);
    expect(formatAdminAssistantDashboardKpiValue("transportation_today", 2, false)).toBe(2);
  });

  it("names missing counts instead of silent em dashes", () => {
    expect(formatAdminAssistantDashboardKpiValue("census", null, false)).toBe(
      "No census count posted",
    );
    expect(formatAdminAssistantDashboardKpiValue("pending_docs", undefined, false)).toBe(
      "No pending docs count posted",
    );
    expect(formatAdminAssistantDashboardKpiValue("transportation_today", null, false)).toBe(
      "No transport count posted",
    );
  });
});

describe("adminAssistantDashboardKpiTileIsMetric", () => {
  it("treats numeric displays as metrics", () => {
    expect(adminAssistantDashboardKpiTileIsMetric(0)).toBe(true);
    expect(adminAssistantDashboardKpiTileIsMetric(12)).toBe(true);
  });

  it("treats gap and loading copy as messages", () => {
    expect(adminAssistantDashboardKpiTileIsMetric("Loading census count…")).toBe(false);
    expect(adminAssistantDashboardKpiTileIsMetric("No census count posted")).toBe(false);
  });
});
