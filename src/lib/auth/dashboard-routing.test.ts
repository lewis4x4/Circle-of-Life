import { describe, expect, it } from "vitest";

import {
  ADMIN_ASSISTANT_ROLE_HOME_AUDIENCE,
  COORDINATOR_ROLE_HOME_AUDIENCE,
  ROLE_HOME_CHECKING_MESSAGE,
  ROLE_HOME_LOADING_LEAD,
  formatRoleHomeBounceMessage,
  formatRoleHomeSubtitle,
  getResolvedRoleLabel,
  getRoleHomeLead,
  isRoleHomeLabelReady,
  isRoleHomePathname,
  isRoleHomeRouteMatch,
  resolveHavenBrandAriaLabel,
  resolveQuietRoleHomeSubtitle,
  resolveQuietRoleLabel,
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

  it("omits quiet flagship subtitles until role home is ready unless a lead is held", () => {
    expect(
      resolveQuietRoleHomeSubtitle(true, "facility_admin", "portfolio movement only.", null),
    ).toBeNull();
    expect(
      resolveQuietRoleHomeSubtitle(true, "owner", "portfolio movement only.", "Owner home"),
    ).toBe("Owner home — portfolio movement only.");
    expect(
      resolveQuietRoleHomeSubtitle(false, "owner", "portfolio movement only.", null),
    ).toBe("Owner home — portfolio movement only.");
  });

  it("holds quiet shell role labels and brand aria across hydration", () => {
    expect(resolveQuietRoleLabel(true, "owner", null)).toBeNull();
    expect(resolveQuietRoleLabel(true, "owner", "Owner")).toBe("Owner");
    expect(resolveQuietRoleLabel(false, "owner", null)).toBe("Owner");
    expect(resolveHavenBrandAriaLabel(null)).toBe("Haven");
    expect(resolveHavenBrandAriaLabel("Owner")).toBe("Haven — go to owner home");
  });

  it("returns a neutral role label for shell chrome while auth is loading", () => {
    expect(getResolvedRoleLabel(true, "facility_admin")).toBe("Loading role");
    expect(getResolvedRoleLabel(false, "owner")).toBe("Owner");
  });

  it("matches role-home routes for assistant and coordinator dashboards", () => {
    expect(isRoleHomeRouteMatch("admin_assistant", "/admin/assistant-dashboard")).toBe(true);
    expect(isRoleHomeRouteMatch("owner", "/admin/assistant-dashboard")).toBe(false);
    expect(isRoleHomeRouteMatch("coordinator", "/admin/coordinator-dashboard")).toBe(true);
    expect(isRoleHomeRouteMatch("owner", "/admin/coordinator-dashboard")).toBe(false);
  });

  it("formats a named bounce when a user opens another role home", () => {
    expect(
      formatRoleHomeBounceMessage(ADMIN_ASSISTANT_ROLE_HOME_AUDIENCE, "Owner"),
    ).toBe("This home is for administrative assistants — opening Owner home…");
    expect(
      formatRoleHomeBounceMessage(COORDINATOR_ROLE_HOME_AUDIENCE, "Owner"),
    ).toBe("This home is for coordinators — opening Owner home…");
  });

  it("names the route-level role-home checking gap", () => {
    expect(ROLE_HOME_CHECKING_MESSAGE).toBe("Checking your role home");
  });

  it("detects role-home dashboard pathnames for loading boundaries", () => {
    expect(isRoleHomePathname("/admin/assistant-dashboard")).toBe(true);
    expect(isRoleHomePathname("/admin/coordinator-dashboard")).toBe(true);
    expect(isRoleHomePathname("/admin/staff")).toBe(false);
    expect(isRoleHomePathname(null)).toBe(false);
  });
});
