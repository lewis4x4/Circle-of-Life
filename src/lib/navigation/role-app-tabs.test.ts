import { describe, expect, it } from "vitest";

import { isHousekeeperAllowedPath } from "@/lib/auth/caregiver-route-access";
import { FAMILY_SECTIONS } from "@/lib/family/family-sections";
import { activeRoleAppTab, ROLE_APP_TABS, roleAppForRole } from "@/lib/navigation/role-app-tabs";

describe("role app tabs (COL-714 owner ruling 2026-09-23)", () => {
  it("gives Med-Tech one app: meds, residents, rounds, clock, me", () => {
    expect(ROLE_APP_TABS["med-tech"].map((tab) => tab.label)).toEqual(["Meds", "Residents", "Rounds", "Clock", "Me"]);
  });

  it("keeps the active tab right across the med-tech and floor route groups", () => {
    const cases: [string, string][] = [
      ["/med-tech", "meds"],
      ["/med-tech/controlled-count", "meds"],
      ["/caregiver/meds", "meds"],
      ["/caregiver/prn-followup", "meds"],
      ["/caregiver", "residents"],
      ["/caregiver/resident/abc/timeline", "residents"],
      ["/caregiver/handoff", "residents"],
      ["/caregiver/rounds/abc", "rounds"],
      ["/caregiver/clock", "clock"],
      ["/caregiver/shift-swaps", "clock"],
      ["/caregiver/me", "me"],
      ["/employee-file/reviews", "me"],
      ["/med-tech/acknowledgments", "me"],
      ["/caregiver/policies/xyz", "me"],
    ];
    for (const [path, key] of cases) {
      expect([path, activeRoleAppTab("med-tech", path)]).toEqual([path, key]);
    }
  });

  it("does not light Meds for /caregiver/meds-lookalikes or Residents for every floor page", () => {
    expect(activeRoleAppTab("med-tech", "/caregiver/medsx")).toBeNull();
    expect(activeRoleAppTab("med-tech", "/caregiver/rounds")).toBe("rounds");
  });

  it("puts My employee file under Me in every staff app", () => {
    for (const app of ["med-tech", "housekeeper", "cook"] as const) {
      expect(activeRoleAppTab(app, "/employee-file")).toBe("me");
    }
  });

  it("only offers housekeepers tabs they are allowed to open", () => {
    for (const tab of ROLE_APP_TABS.housekeeper) {
      expect([tab.href, isHousekeeperAllowedPath(tab.href)]).toEqual([tab.href, true]);
      for (const route of tab.also ?? []) expect([route, isHousekeeperAllowedPath(route)]).toEqual([route, true]);
    }
  });

  it("renders the family sections as the family tabs (one list, COL-655)", () => {
    expect(ROLE_APP_TABS.family.map((tab) => tab.href)).toEqual(FAMILY_SECTIONS.map((section) => section.href));
    expect(activeRoleAppTab("family", "/family")).toBe("today");
    expect(activeRoleAppTab("family", "/family/payments")).toBe("billing");
  });

  it("maps login roles to their app", () => {
    expect(roleAppForRole("med_tech")).toBe("med-tech");
    expect(roleAppForRole("cook")).toBe("cook");
    expect(roleAppForRole("housekeeper")).toBe("housekeeper");
    expect(roleAppForRole("family")).toBe("family");
    expect(roleAppForRole("owner")).toBeNull();
  });
});
