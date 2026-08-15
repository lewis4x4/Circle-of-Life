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
    expect(all.some((entry) => entry.href === "/admin/dietary" && entry.key === "snack-pass")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/knowledge")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/incidents")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/finance")).toBe(true);
  });
});
