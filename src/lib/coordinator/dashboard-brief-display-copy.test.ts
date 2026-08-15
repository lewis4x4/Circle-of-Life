import { describe, expect, it } from "vitest";

import {
  COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY,
  COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY,
  formatCoordinatorDashboardResidentName,
} from "./dashboard-brief-display-copy";

const EM_DASH = "—";

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
