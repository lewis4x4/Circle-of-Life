import { describe, expect, it } from "vitest";

import {
  formatExecutiveOccupancyPctWithSuffix,
  resolveOfficerOccupancyTileLabel,
} from "@/lib/executive/executive-display-copy";
import { aggregatePortfolioOccupancy, computePortfolioOccupancyPct } from "@/lib/occupancy/portfolio-occupancy-display";

describe("resolveOfficerOccupancyTileLabel", () => {
  it("uses portfolio label when every facility has posted census", () => {
    expect(
      resolveOfficerOccupancyTileLabel(false, {
        allFacilitiesPosted: true,
        postedFacilityCount: 5,
        totalFacilityCount: 5,
      }),
    ).toBe("Portfolio occupancy");
  });

  it("uses posted-sites label when census is partial", () => {
    expect(
      resolveOfficerOccupancyTileLabel(false, {
        allFacilitiesPosted: false,
        postedFacilityCount: 2,
        totalFacilityCount: 5,
      }),
    ).toBe("Posted-sites occupancy");
  });

  it("uses this-facility label when header scopes one site", () => {
    expect(resolveOfficerOccupancyTileLabel(true)).toBe("This facility occupancy");
  });
});

describe("officer occupancy tile scope alignment", () => {
  const portfolioPct = computePortfolioOccupancyPct(33, 100);
  const facilityPct = computePortfolioOccupancyPct(33, 40);

  it("keeps portfolio and facility values distinct", () => {
    const label = resolveOfficerOccupancyTileLabel(false, {
      allFacilitiesPosted: true,
      postedFacilityCount: 5,
      totalFacilityCount: 5,
    });
    const value = formatExecutiveOccupancyPctWithSuffix(portfolioPct);

    expect(label).toBe("Portfolio occupancy");
    expect(value).toBe("33.0%");
    expect(value).not.toBe(formatExecutiveOccupancyPctWithSuffix(facilityPct));
  });

  it("labels partial portfolio occupancy as posted-sites-only", () => {
    const partial = aggregatePortfolioOccupancy([
      { censusPosted: true, occupied: 33, denominatorBeds: 100 },
      { censusPosted: false, occupied: 0, denominatorBeds: 0 },
    ]);
    const label = resolveOfficerOccupancyTileLabel(false, partial);
    expect(label).toBe("Posted-sites occupancy");
    expect(formatExecutiveOccupancyPctWithSuffix(partial.occupancyPct)).toBe("33.0%");
  });

  it("posted-empty stays 0% and unloaded stays a named gap in both scopes", () => {
    for (const facilityScoped of [false, true]) {
      const label = resolveOfficerOccupancyTileLabel(facilityScoped);
      expect(label.length).toBeGreaterThan(0);
      expect(formatExecutiveOccupancyPctWithSuffix(0)).toBe("0%");
      expect(formatExecutiveOccupancyPctWithSuffix(null)).toBe("No occupancy posted");
    }
  });
});
