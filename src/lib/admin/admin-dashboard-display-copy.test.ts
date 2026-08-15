import { describe, expect, it } from "vitest";

import {
  ADMIN_DASHBOARD_NO_DATE_COPY,
  formatAdminDashboardResidentDobDisplay,
} from "./admin-dashboard-display-copy";

const EM_DASH = "—";

describe("formatAdminDashboardResidentDobDisplay", () => {
  it("names a missing DOB instead of a silent em dash", () => {
    expect(formatAdminDashboardResidentDobDisplay(null)).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay(undefined)).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay(null)).not.toBe(EM_DASH);
  });

  it("names a blank DOB instead of a silent em dash", () => {
    expect(formatAdminDashboardResidentDobDisplay("")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay("   ")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay("")).not.toBe(EM_DASH);
  });

  it("names an em dash DOB instead of showing a silent dash", () => {
    expect(formatAdminDashboardResidentDobDisplay(EM_DASH)).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay(`  ${EM_DASH}  `)).toBe(
      ADMIN_DASHBOARD_NO_DATE_COPY,
    );
    expect(formatAdminDashboardResidentDobDisplay(EM_DASH)).not.toBe(EM_DASH);
  });

  it("names legacy Unknown DOB copy with a named gap", () => {
    expect(formatAdminDashboardResidentDobDisplay("Unknown")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay("  unknown  ")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
  });

  it("names an unparseable DOB with a named gap", () => {
    expect(formatAdminDashboardResidentDobDisplay("not-a-date")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
    expect(formatAdminDashboardResidentDobDisplay("2026-13-40")).toBe(ADMIN_DASHBOARD_NO_DATE_COPY);
  });

  it("formats a posted YYYY-MM-DD DOB as UTC MM/DD/YYYY", () => {
    expect(formatAdminDashboardResidentDobDisplay("2000-01-15")).toBe("01/15/2000");
    expect(formatAdminDashboardResidentDobDisplay("  2000-01-15  ")).toBe("01/15/2000");
  });
});
