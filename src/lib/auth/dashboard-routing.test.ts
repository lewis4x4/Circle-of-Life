import { describe, expect, it } from "vitest";

import {
  ROLE_HOME_LOADING_LEAD,
  formatRoleHomeSubtitle,
  getResolvedRoleLabel,
  getRoleHomeLead,
  isRoleHomeLabelReady,
} from "./dashboard-routing";

describe("role home chrome helpers", () => {
  it("does not expose a mismatched role-home lead while auth is loading", () => {
    expect(getRoleHomeLead(true, "facility_admin")).toBe(ROLE_HOME_LOADING_LEAD);
    expect(getRoleHomeLead(true, "owner")).toBe(ROLE_HOME_LOADING_LEAD);
    expect(getRoleHomeLead(true, "")).toBe(ROLE_HOME_LOADING_LEAD);
  });

  it("does not expose a role-home lead before the session role is known", () => {
    expect(isRoleHomeLabelReady(false, "")).toBe(false);
    expect(getRoleHomeLead(false, "")).toBe(ROLE_HOME_LOADING_LEAD);
  });

  it("returns the hydrated role-home lead once auth and role are known", () => {
    expect(isRoleHomeLabelReady(false, "owner")).toBe(true);
    expect(getRoleHomeLead(false, "owner")).toBe("Owner home");
    expect(getRoleHomeLead(false, "facility_admin")).toBe("Facility Admin home");
  });

  it("formats full subtitles with a named loading gap until hydration", () => {
    expect(
      formatRoleHomeSubtitle(true, "facility_admin", "portfolio movement only."),
    ).toBe("Loading role home — portfolio movement only.");
    expect(
      formatRoleHomeSubtitle(false, "owner", "portfolio movement only."),
    ).toBe("Owner home — portfolio movement only.");
  });

  it("returns a neutral role label for shell chrome while auth is loading", () => {
    expect(getResolvedRoleLabel(true, "facility_admin")).toBe("Loading role");
    expect(getResolvedRoleLabel(false, "owner")).toBe("Owner");
  });
});
