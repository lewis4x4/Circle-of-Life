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

  it("removes the hold-offs from owner menus and leaves Vendors & AP on Business", () => {
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

  it("still gives brokers Insurance when that is their only allowlisted tool", () => {
    const items = pillarsForRole(getRoleDashboardConfig("broker")).flatMap((pillar) => pillar.items);
    expect(items.map((item) => item.key)).toEqual(["insurance"]);
  });
});
