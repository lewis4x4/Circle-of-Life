import { describe, expect, it } from "vitest";

import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { pillarsForRole } from "@/lib/navigation/pillars";
import {
  filterStaffLaunchHiddenItems,
  isStaffLaunchHiddenKey,
  STAFF_LAUNCH_HIDDEN_NAV,
} from "@/lib/navigation/staff-launch-hidden";

describe("staff-launch hidden nav", () => {
  it("keeps the first-wave hold-offs in the restore inventory", () => {
    expect(STAFF_LAUNCH_HIDDEN_NAV.map((item) => item.key)).toEqual([
      "discharge",
      "med-tech",
      "medications",
      "medication-errors",
      "dietary",
      "finance",
      "insurance",
    ]);
  });

  it("hides catalog keys unless the role’s only allowlisted item is that key", () => {
    expect(isStaffLaunchHiddenKey("discharge")).toBe(true);
    expect(isStaffLaunchHiddenKey("insurance", ["insurance"])).toBe(false);
    expect(isStaffLaunchHiddenKey("insurance", ["finance", "insurance"])).toBe(true);
    expect(
      filterStaffLaunchHiddenItems(
        [{ key: "vendors" }, { key: "finance" }, { key: "insurance" }],
      ).map((item) => item.key),
    ).toEqual(["vendors"]);
  });

  it("removes the hold-offs from menus when no role is given and leaves Vendors & AP on Business", () => {
    const items = pillarsForRole(getRoleDashboardConfig("owner")).flatMap((pillar) => pillar.items);
    const keys = items.map((item) => item.key);

    expect(keys).not.toContain("discharge");
    expect(keys).not.toContain("med-tech");
    expect(keys).not.toContain("medications");
    expect(keys).not.toContain("medication-errors");
    expect(keys).not.toContain("dietary");
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("insurance");
    expect(keys).toContain("vendors");
    expect(keys).toContain("transportation");
    expect(keys).toContain("referrals");
  });

  it.each(["owner", "org_admin", "facility_admin", "manager"])(
    "shows Finance and Insurance to %s — hold lifted for owners and admins (Brian, 2026-09-23)",
    (role) => {
      const keys = pillarsForRole(getRoleDashboardConfig(role), role).flatMap((pillar) => pillar.items).map((item) => item.key);
      expect(keys).toContain("finance");
      expect(keys).toContain("insurance");
      // The rest of the hold stands.
      expect(keys).not.toContain("discharge");
      expect(keys).not.toContain("medications");
    },
  );

  it("keeps Finance and Insurance held for roles the ruling does not name", () => {
    expect(isStaffLaunchHiddenKey("finance", undefined, "admin_assistant")).toBe(true);
    expect(isStaffLaunchHiddenKey("insurance", ["facilities", "vendors", "insurance"], "maintenance_role")).toBe(true);
    expect(isStaffLaunchHiddenKey("finance", undefined, "owner")).toBe(false);
  });

  it("still gives brokers Insurance when that is their only allowlisted tool", () => {
    const items = pillarsForRole(getRoleDashboardConfig("broker")).flatMap((pillar) => pillar.items);
    expect(items.map((item) => item.key)).toEqual(["insurance"]);
  });
});
