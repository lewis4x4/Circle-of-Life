import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Timeline tab operator copy and date defaults", () => {
  it("TimelineTab.tsx uses Eastern today helper, not UTC ISO slice", () => {
    const source = readSource("src/components/admin/facilities/tabs/TimelineTab.tsx");

    expect(source).toContain("createDefaultTimelineEventForm");
    expect(source).toContain("TIMELINE_TAB_NO_EVENTS_COPY");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(source).not.toMatch(/useState<TimelineEventInput>\(\s*\{/);
  });

  it("timeline-tab-display-copy.ts anchors defaults on todayFacilityDateIso", () => {
    const source = readSource("src/lib/facilities/timeline-tab-display-copy.ts");

    expect(source).toContain("todayFacilityDateIso");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
