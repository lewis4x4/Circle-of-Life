import { describe, expect, it } from "vitest";

import {
  STAFFING_TAB_ACTIVE_STAFF_COUNT_HINT,
  STAFFING_TAB_NO_ADMINISTRATOR_COPY,
  STAFFING_TAB_NO_ROSTER_DATE_COPY,
  formatStaffingTabAdministratorName,
  formatStaffingTabRosterDate,
} from "./staffing-tab-display-copy";

const EM_DASH = "—";

describe("formatStaffingTabRosterDate", () => {
  it("names a missing roster date instead of an em dash", () => {
    expect(formatStaffingTabRosterDate(null)).toBe(STAFFING_TAB_NO_ROSTER_DATE_COPY);
    expect(formatStaffingTabRosterDate(undefined)).toBe(STAFFING_TAB_NO_ROSTER_DATE_COPY);
    expect(formatStaffingTabRosterDate("")).toBe(STAFFING_TAB_NO_ROSTER_DATE_COPY);
    expect(formatStaffingTabRosterDate("not-a-date")).toBe(STAFFING_TAB_NO_ROSTER_DATE_COPY);
    expect(formatStaffingTabRosterDate(null)).not.toBe(EM_DASH);
  });

  it("formats a posted roster timestamp in Eastern time", () => {
    const formatted = formatStaffingTabRosterDate("2026-08-15T12:00:00.000Z");
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toBe(STAFFING_TAB_NO_ROSTER_DATE_COPY);
  });
});

describe("formatStaffingTabAdministratorName", () => {
  it("names a missing administrator instead of an em dash", () => {
    expect(formatStaffingTabAdministratorName(null)).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatStaffingTabAdministratorName(undefined)).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatStaffingTabAdministratorName("")).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatStaffingTabAdministratorName("   ")).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatStaffingTabAdministratorName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted administrator name", () => {
    expect(formatStaffingTabAdministratorName("Supervisor A")).toBe("Supervisor A");
  });
});

describe("STAFFING_TAB_ACTIVE_STAFF_COUNT_HINT", () => {
  it("reads as unique people rather than raw row counts", () => {
    expect(STAFFING_TAB_ACTIVE_STAFF_COUNT_HINT.toLowerCase()).toContain("unique");
    expect(STAFFING_TAB_ACTIVE_STAFF_COUNT_HINT.toLowerCase()).toContain("people");
  });
});
