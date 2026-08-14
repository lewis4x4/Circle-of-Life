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

    expect(quick.length).toBeGreaterThan(0);
    expect(quick.length).toBeLessThan(all.length);
    expect(quick.map((entry) => entry.key)).toContain("executive");
    expect(quick.map((entry) => entry.key)).toContain("family-messages");
    expect(all.some((entry) => entry.href === "/admin/family-messages")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/knowledge")).toBe(true);
    expect(all.some((entry) => entry.href === "/admin/finance")).toBe(true);
  });
});
