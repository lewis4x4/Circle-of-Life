import { describe, expect, it } from "vitest";

import {
  canOpenExecutiveHubHref,
  canOpenExecutiveOverview,
  canOpenExecutiveStandup,
  resolveExecutiveCommandNav,
} from "./executive-nav-access";

describe("executive nav access", () => {
  it("keeps overview and standup for owner / org admin", () => {
    expect(canOpenExecutiveOverview("owner")).toBe(true);
    expect(canOpenExecutiveStandup("owner")).toBe(true);
    expect(resolveExecutiveCommandNav("owner")).toEqual({
      href: "/admin/executive",
      label: "Executive summary",
    });
    expect(canOpenExecutiveHubHref("org_admin", "/admin/executive/reports")).toBe(true);
  });

  it("points facility admin at standup and not the overview bounce", () => {
    expect(canOpenExecutiveOverview("facility_admin")).toBe(false);
    expect(canOpenExecutiveStandup("facility_admin")).toBe(true);
    expect(resolveExecutiveCommandNav("facility_admin")).toEqual({
      href: "/admin/executive/standup",
      label: "Standup",
    });
    expect(canOpenExecutiveHubHref("facility_admin", "/admin/executive")).toBe(false);
    expect(canOpenExecutiveHubHref("facility_admin", "/admin/executive/standup")).toBe(true);
    expect(canOpenExecutiveHubHref("facility_admin", "/admin/executive/standup/history")).toBe(
      true,
    );
    expect(canOpenExecutiveHubHref("facility_admin", "/admin/executive/reports")).toBe(false);
  });

  it("hides executive command nav for roles that cannot open standup or overview", () => {
    expect(resolveExecutiveCommandNav("manager")).toBeNull();
    expect(resolveExecutiveCommandNav("nurse")).toBeNull();
    expect(canOpenExecutiveStandup("manager")).toBe(false);
    expect(canOpenExecutiveHubHref("nurse", "/admin/executive/standup")).toBe(false);
  });
});
