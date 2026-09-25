import { describe, expect, it } from "vitest";

import {
  PILLARS,
  allSectionJumpEntries,
  findActivePillar,
  sectionJumpQuickEntries,
} from "./pillars";

describe("pillars navigation", () => {
  it("does not place reputation under the Quality pillar", () => {
    const qualityPillar = PILLARS.find((pillar) => pillar.id === "quality");

    expect(qualityPillar).toBeDefined();
    expect(qualityPillar?.items.map((item) => item.key)).not.toContain("reputation");
    expect(qualityPillar?.items.map((item) => item.href)).not.toContain("/admin/reputation");
  });

  it("does not assign the reputation route to any pillar", () => {
    expect(findActivePillar("/admin/reputation")?.id).not.toBe("quality");
  });

  it("exposes quick jump entries and the full searchable section list", () => {
    const quick = sectionJumpQuickEntries();
    const all = allSectionJumpEntries();

    expect(quick).toHaveLength(6);
    expect(quick.length).toBeLessThan(all.length);
    expect(quick.map((entry) => entry.key)).toEqual([
      "executive",
      "residents",
      "billing",
      "family-portal",
      "rounding-live",
      "snack-pass",
    ]);
    expect(quick.find((entry) => entry.key === "billing")?.label).toBe("Billing");
    expect(quick.find((entry) => entry.key === "residents")?.label).toBe("Resident roster / census");
    expect(all.some((entry) => entry.href === "/admin/family-portal")).toBe(true);
    expect(all.some((entry) => entry.href.startsWith("/admin/family-messages"))).toBe(false);
    expect(all.some((entry) => entry.href === "/admin/rounding/live")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/dietary#snack-pass" && entry.key === "snack-pass")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/knowledge")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/incidents")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/finance")).toBe(true);
  });
});

import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { applyFacilityOperatorNav, pillarsForRole } from "./pillars";
import { applyExecutiveCommandNavToItems } from "@/lib/auth/executive-nav-access";

describe("role navigation", () => {
  it("keeps broker navigation in insurance instead of falling back to all tools", () => {
    const items = pillarsForRole(getRoleDashboardConfig("broker")).flatMap((p) => p.items);
    expect(items.map((i) => i.key)).toContain("insurance");
    expect(items.map((i) => i.key)).not.toContain("residents");
    expect(items.map((i) => i.key)).not.toContain("payroll");
  });
  it("applies med_tech item restrictions within clinical and quality groups", () => {
    const items = pillarsForRole(getRoleDashboardConfig("med_tech")).flatMap((p) => p.items);
    expect(items.map((i) => i.key)).toContain("residents");
    expect(items.map((i) => i.key)).not.toContain("transportation");
  });

  it("gives Administrator, Assistant Administrator and Manager the identical Command rail (COL-571)", () => {
    const facilities = [{ id: "00000000-0000-0000-0002-000000000003", name: "One building" }];
    const railFor = (role: string) =>
      applyFacilityOperatorNav(pillarsForRole(getRoleDashboardConfig(role)), role, facilities).map((pillar) => ({
        ...pillar,
        items: applyExecutiveCommandNavToItems(pillar.items, role, false),
      }));
    const admin = railFor("facility_admin");
    const manager = railFor("manager");
    expect(manager).toEqual(admin);

    const command = admin.find((pillar) => pillar.id === "command");
    expect(command?.items.map((item) => item.label)).toEqual([
      "Home",
      "Weekly Stand Up",
      "Reports hub",
      "My facility",
      "Billing & AR",
      "Document Intake",
      "Transportation",
    ]);
    const myFacility = command?.items.find((item) => item.key === "facilities");
    expect(myFacility?.href).toBe("/admin/facilities/00000000-0000-0000-0002-000000000003");

    const keys = admin.flatMap((pillar) => pillar.items.map((item) => item.key));
    expect(keys).not.toContain("executive");
    expect(keys).not.toContain("med-tech");
  });

  it("keeps the facility list for operators who cover more than one building", () => {
    const pillars = applyFacilityOperatorNav(
      pillarsForRole(getRoleDashboardConfig("facility_admin")),
      "facility_admin",
      [
        { id: "a", name: "Building A" },
        { id: "b", name: "Building B" },
      ],
    );
    const facilities = pillars.find((p) => p.id === "command")?.items.find((i) => i.key === "facilities");
    expect(facilities?.label).toBe("Facilities");
    expect(facilities?.href).toBe("/admin/facilities");
  });

  it("leaves owner navigation untouched", () => {
    const pillars = pillarsForRole(getRoleDashboardConfig("owner"));
    expect(applyFacilityOperatorNav(pillars, "owner", [{ id: "a", name: "Building A" }])).toEqual(pillars);
  });
});
