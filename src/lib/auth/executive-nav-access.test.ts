import { describe, expect, it } from "vitest";

import {
  applyExecutiveCommandNavToItems,
  canOpenExecutiveHubHref,
  canOpenExecutiveOverview,
  canOpenExecutiveStandup,
  resolveExecutiveCommandNav,
} from "./executive-nav-access";

describe("executive nav access", () => {
  it("exposes weekly entry to owners, org admins, and every facility operator title", () => {
    const items = [{ key: "stand-up", href: "/admin/stand-up", label: "Weekly Stand Up" }];
    for (const role of ["owner", "org_admin", "facility_admin", "manager"]) {
      expect(applyExecutiveCommandNavToItems(items, role, false)).toEqual(items);
      expect(canOpenExecutiveHubHref(role, "/admin/stand-up")).toBe(true);
    }
    expect(applyExecutiveCommandNavToItems(items, "med_tech", false)).toEqual([]);
    expect(applyExecutiveCommandNavToItems(items, "owner", true)).toEqual([]);
  });
  it("keeps overview and standup for owner / org admin", () => {
    expect(canOpenExecutiveOverview("owner")).toBe(true);
    expect(canOpenExecutiveStandup("owner")).toBe(true);
    expect(resolveExecutiveCommandNav("owner")).toEqual({
      href: "/admin/executive",
      label: "Executive summary",
    });
    expect(canOpenExecutiveHubHref("org_admin", "/admin/executive/alerts")).toBe(true);
  });

  it("gives facility operators no Executive rail item while the standup hub stays reachable", () => {
    for (const role of ["facility_admin", "manager"]) {
      expect(canOpenExecutiveOverview(role)).toBe(false);
      expect(canOpenExecutiveStandup(role)).toBe(true);
      expect(resolveExecutiveCommandNav(role)).toBeNull();
      expect(canOpenExecutiveHubHref(role, "/admin/executive")).toBe(false);
      expect(canOpenExecutiveHubHref(role, "/admin/executive/standup")).toBe(true);
      expect(canOpenExecutiveHubHref(role, "/admin/executive/standup/history")).toBe(true);
      expect(canOpenExecutiveHubHref(role, "/admin/executive/alerts")).toBe(false);
    }
  });

  it("treats Administrator, Assistant Administrator and Manager identically (COL-571)", () => {
    const items = [
      { key: "owner-home", href: "/admin", label: "Home" },
      { key: "executive", href: "/admin/executive", label: "Executive" },
      { key: "stand-up", href: "/admin/stand-up", label: "Weekly Stand Up" },
    ];
    expect(applyExecutiveCommandNavToItems(items, "manager", false)).toEqual(
      applyExecutiveCommandNavToItems(items, "facility_admin", false),
    );
  });

  it("hides executive command nav for roles that cannot open standup or overview", () => {
    expect(resolveExecutiveCommandNav("med_tech")).toBeNull();
    expect(canOpenExecutiveStandup("med_tech")).toBe(false);
    expect(canOpenExecutiveHubHref("med_tech", "/admin/executive/standup")).toBe(false);
  });

  it("rewrites Command Executive items for the live AppShell role", () => {
    const items = [
      { key: "owner-home", href: "/admin", label: "Owner home" },
      { key: "executive", href: "/admin/executive", label: "Executive" },
    ];
    expect(applyExecutiveCommandNavToItems(items, "owner", false)).toEqual([
      { key: "owner-home", href: "/admin", label: "Owner home" },
      { key: "executive", href: "/admin/executive", label: "Executive" },
    ]);
    expect(applyExecutiveCommandNavToItems(items, "facility_admin", false)).toEqual([
      { key: "owner-home", href: "/admin", label: "Owner home" },
    ]);
    expect(applyExecutiveCommandNavToItems(items, "med_tech", false)).toEqual([
      { key: "owner-home", href: "/admin", label: "Owner home" },
    ]);
    expect(applyExecutiveCommandNavToItems(items, "facility_admin", true)).toEqual([
      { key: "owner-home", href: "/admin", label: "Owner home" },
    ]);
  });
});
