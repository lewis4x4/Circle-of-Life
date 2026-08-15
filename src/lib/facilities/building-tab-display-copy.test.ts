import { describe, expect, it } from "vitest";

import {
  BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY,
  buildingTabLicensedBedCountIsMissing,
  formatBuildingTabLicensedBedCount,
} from "./building-tab-display-copy";

const EM_DASH = "—";

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
