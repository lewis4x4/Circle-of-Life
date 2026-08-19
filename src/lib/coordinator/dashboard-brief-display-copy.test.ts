import { describe, expect, it } from "vitest";

import {
  COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
  COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY,
  coordinatorDashboardKpiTileIsMetric,
  formatCoordinatorDashboardKpiValue,
  formatCoordinatorDashboardResidentName,
} from "./dashboard-brief-display-copy";

const EM_DASH = "—";

describe("formatCoordinatorDashboardKpiValue", () => {
  it("returns named loading copy per tile", () => {
    expect(formatCoordinatorDashboardKpiValue("active_care_plans", 0, true)).toBe(
      "Loading care plan count…",
    );
    expect(formatCoordinatorDashboardKpiValue("reviews_due_14d", 2, true)).toBe(
      "Loading review count…",
    );
    expect(formatCoordinatorDashboardKpiValue("pending_assessments", null, true)).toBe(
      "Loading assessment count…",
    );
    expect(formatCoordinatorDashboardKpiValue("staff_bulletin_notes", undefined, true)).toBe(
      "Loading bulletin notes…",
    );
  });

  it("keeps real zero as numeric zero when loaded", () => {
    expect(formatCoordinatorDashboardKpiValue("active_care_plans", 0, false)).toBe(0);
    expect(formatCoordinatorDashboardKpiValue("reviews_due_14d", 0, false)).toBe(0);
    expect(formatCoordinatorDashboardKpiValue("recent_condition_changes", 0, false)).toBe(0);
    expect(formatCoordinatorDashboardKpiValue("active_admissions", 0, false)).toBe(0);
  });

  it("names missing counts instead of silent em dashes", () => {
    expect(formatCoordinatorDashboardKpiValue("active_care_plans", null, false)).toBe(
      "No care plan count posted",
    );
    expect(formatCoordinatorDashboardKpiValue("active_admissions", undefined, false)).toBe(
      "No admission count posted",
    );
  });
});

describe("coordinatorDashboardKpiTileIsMetric", () => {
  it("treats numeric displays as metrics", () => {
    expect(coordinatorDashboardKpiTileIsMetric(0)).toBe(true);
    expect(coordinatorDashboardKpiTileIsMetric(5)).toBe(true);
  });

  it("treats gap and loading copy as messages", () => {
    expect(coordinatorDashboardKpiTileIsMetric("Loading care plan count…")).toBe(false);
    expect(coordinatorDashboardKpiTileIsMetric("No review count posted")).toBe(false);
  });
});

describe("formatCoordinatorDashboardResidentName", () => {
  it("names a missing resident instead of Unknown", () => {
    expect(formatCoordinatorDashboardResidentName(null)).toBe(
      COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName(undefined)).toBe(
      COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName(null)).not.toBe("Unknown");
  });

  it("names a blank resident name instead of inventing one", () => {
    expect(formatCoordinatorDashboardResidentName({ first_name: null, last_name: null })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: "", last_name: "" })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: "   ", last_name: "  " })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
  });

  it("names an em dash resident name instead of a silent dash", () => {
    expect(formatCoordinatorDashboardResidentName({ first_name: EM_DASH, last_name: null })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: `  ${EM_DASH}  `, last_name: "" })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatCoordinatorDashboardResidentName({ first_name: "Unknown", last_name: null })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: "  Unknown  ", last_name: "" })).toBe(
      COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: "Unknown", last_name: null })).not.toBe(
      "Unknown",
    );
  });

  it("returns posted first and last names trimmed", () => {
    expect(formatCoordinatorDashboardResidentName({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatCoordinatorDashboardResidentName({ first_name: "  Jordan  ", last_name: " Lee " })).toBe(
      "Jordan Lee",
    );
  });
});
