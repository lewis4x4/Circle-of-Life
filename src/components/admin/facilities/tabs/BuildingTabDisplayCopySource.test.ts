import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const FORBIDDEN_BUILDING_TAB_COPY = [
  "schema sprint",
  "launch sprint",
  "TODO",
  "deferred to",
  "indicator scaffold",
  "compliance-rules",
  "engine sprint",
  "— schema sprint",
];

describe("Building tab operator copy — no engineering placeholders", () => {
  it("BuildingTab.tsx uses named gaps instead of sprint dashes or TODOs", () => {
    const source = readSource("src/components/admin/facilities/tabs/BuildingTab.tsx");

    for (const forbidden of FORBIDDEN_BUILDING_TAB_COPY) {
      expect(source, `BuildingTab still contains ${forbidden}`).not.toContain(forbidden);
    }

    expect(source).toContain("BUILDING_TAB_NO_RESIDENT_ROOM_COUNT_COPY");
    expect(source).toContain("BUILDING_TAB_NO_COMMON_AREA_SQFT_COPY");
    expect(source).toContain("BUILDING_TAB_NO_96_HOUR_READINESS_COPY");
    expect(source).toContain("BUILDING_TAB_SPRINKLER_DETAIL_FOOTNOTE_COPY");
    expect(source).toContain("BUILDING_TAB_NO_SECTION_AUDIT_TRAIL_COPY");
    expect(source).toContain("BUILDING_TAB_AGGREGATE_AUDIT_FOOTNOTE_COPY");
  });

  it("FacilityBuildingMetricsStrip.tsx names county OEM gap without sprint jargon", () => {
    const source = readSource("src/components/admin/facilities/FacilityBuildingMetricsStrip.tsx");

    for (const forbidden of FORBIDDEN_BUILDING_TAB_COPY) {
      expect(source, `FacilityBuildingMetricsStrip still contains ${forbidden}`).not.toContain(forbidden);
    }

    expect(source).toContain("BUILDING_TAB_NO_COUNTY_OEM_STATUS_HELPER_COPY");
  });
});
