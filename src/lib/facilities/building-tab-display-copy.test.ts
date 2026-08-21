import { describe, expect, it } from "vitest";

import {
  BUILDING_TAB_HELPER,
  BUILDING_TAB_NO_CEMP_STATUS_COPY,
  BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY,
  BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY,
  BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY,
  BUILDING_TAB_NO_SECURE_UNIT_COPY,
  BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY,
  BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY,
  BUILDING_TAB_NO_STORM_HARDENING_COPY,
  BUILDING_TAB_SCAFFOLD_GAP_COPIES,
  buildingTabLicensedBedCountIsMissing,
  formatBuildingTabLicensedBedCount,
  formatBuildingTabScaffoldValue,
} from "./building-tab-display-copy";

const EM_DASH = "—";

describe("BUILDING_TAB_HELPER", () => {
  it("explains named gaps without implying the tab is complete", () => {
    expect(BUILDING_TAB_HELPER).toMatch(/not captured yet/i);
    expect(BUILDING_TAB_HELPER).toMatch(/not silent blanks/i);
  });
});

describe("BUILDING_TAB_SCAFFOLD_GAP_COPIES", () => {
  it("names every uncaptured scaffold row instead of an em dash", () => {
    expect(BUILDING_TAB_SCAFFOLD_GAP_COPIES).toHaveLength(12);
    for (const gap of BUILDING_TAB_SCAFFOLD_GAP_COPIES) {
      expect(gap).toMatch(/^No .+ posted$/);
      expect(gap).not.toBe(EM_DASH);
    }
  });

  it("covers sprinkler, generator, elopement, and storm scaffold rows", () => {
    expect(BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY).toBe("No sprinkler coverage posted");
    expect(BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY).toBe("No generator manufacturer posted");
    expect(BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY).toBe("No elopement drill posted");
    expect(BUILDING_TAB_NO_CEMP_STATUS_COPY).toBe("No CEMP status posted");
    expect(BUILDING_TAB_NO_STORM_HARDENING_COPY).toBe("No storm hardening posted");
  });
});

describe("formatBuildingTabScaffoldValue", () => {
  const gapCopy = BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY;

  it("names a missing scaffold value instead of an em dash", () => {
    expect(formatBuildingTabScaffoldValue(null, gapCopy)).toBe(gapCopy);
    expect(formatBuildingTabScaffoldValue(undefined, gapCopy)).toBe(gapCopy);
    expect(formatBuildingTabScaffoldValue("", gapCopy)).toBe(gapCopy);
    expect(formatBuildingTabScaffoldValue("   ", gapCopy)).toBe(gapCopy);
    expect(formatBuildingTabScaffoldValue(EM_DASH, gapCopy)).toBe(gapCopy);
    expect(formatBuildingTabScaffoldValue(null, gapCopy)).not.toBe(EM_DASH);
  });

  it("keeps real zero numeric instead of treating it as missing", () => {
    expect(formatBuildingTabScaffoldValue(0, BUILDING_TAB_NO_SECURE_UNIT_COPY)).toBe("0");
    expect(formatBuildingTabScaffoldValue(0, BUILDING_TAB_NO_SECURE_UNIT_COPY)).not.toBe(
      BUILDING_TAB_NO_SECURE_UNIT_COPY,
    );
  });

  it("returns a posted string trimmed", () => {
    expect(formatBuildingTabScaffoldValue("  wet  ", BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY)).toBe("wet");
    expect(formatBuildingTabScaffoldValue("Generac 22kW", BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY)).toBe(
      "Generac 22kW",
    );
  });
});

describe("formatBuildingTabLicensedBedCount", () => {
  it("names a missing licensed-bed count instead of an em dash", () => {
    expect(formatBuildingTabLicensedBedCount(null)).toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
    expect(formatBuildingTabLicensedBedCount(undefined)).toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
    expect(formatBuildingTabLicensedBedCount(Number.NaN)).toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
    expect(formatBuildingTabLicensedBedCount(null)).not.toBe(EM_DASH);
  });

  it("keeps real zero numeric instead of treating it as missing", () => {
    expect(formatBuildingTabLicensedBedCount(0)).toBe("0");
    expect(formatBuildingTabLicensedBedCount(0)).not.toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
    expect(buildingTabLicensedBedCountIsMissing(0)).toBe(false);
  });

  it("returns a posted positive licensed-bed count", () => {
    expect(formatBuildingTabLicensedBedCount(52)).toBe("52");
    expect(buildingTabLicensedBedCountIsMissing(52)).toBe(false);
  });
});

describe("buildingTabLicensedBedCountIsMissing", () => {
  it("flags nullish values as missing", () => {
    expect(buildingTabLicensedBedCountIsMissing(null)).toBe(true);
    expect(buildingTabLicensedBedCountIsMissing(undefined)).toBe(true);
  });

  it("does not flag a finite number as missing", () => {
    expect(buildingTabLicensedBedCountIsMissing(0)).toBe(false);
    expect(buildingTabLicensedBedCountIsMissing(36)).toBe(false);
  });
});
