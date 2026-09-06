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
      "family-messages",
      "rounding-live",
      "snack-pass",
    ]);
    expect(quick.find((entry) => entry.key === "billing")?.label).toBe("Billing");
    expect(quick.find((entry) => entry.key === "residents")?.label).toBe("Resident roster / census");
    expect(all.some((entry) => entry.href === "/admin/family-messages")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/rounding/live")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/dietary#snack-pass" && entry.key === "snack-pass")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/knowledge")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/incidents")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/finance")).toBe(true);
  });
});

import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { pillarsForRole } from "./pillars";

describe("role navigation", () => {
  it("keeps broker navigation in insurance instead of falling back to all tools", () => {
    const items = pillarsForRole(getRoleDashboardConfig("broker")).flatMap((p) => p.items);
    expect(items.map((i) => i.key)).toContain("insurance");
    expect(items.map((i) => i.key)).not.toContain("residents");
    expect(items.map((i) => i.key)).not.toContain("payroll");
  });
  it("applies nurse item restrictions within clinical and quality groups", () => {
    const items = pillarsForRole(getRoleDashboardConfig("nurse")).flatMap((p) => p.items);
    expect(items.map((i) => i.key)).toContain("residents");
    expect(items.map((i) => i.key)).not.toContain("transportation");
  });
});
