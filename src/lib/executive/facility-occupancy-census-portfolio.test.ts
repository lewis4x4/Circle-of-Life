import { describe, expect, it } from "vitest";

import { computePortfolioOccupancyFromBedCensus } from "./facility-occupancy-census";

describe("computePortfolioOccupancyFromBedCensus", () => {
  it("returns null when no facilities have posted census", () => {
    const facilities = [
      { id: "site-a", total_licensed_beds: 50 },
      { id: "site-b", total_licensed_beds: 50 },
    ];
    const census = new Map<string, never>();

    const result = computePortfolioOccupancyFromBedCensus(facilities, census);
    expect(result.occupancyPct).toBeNull();
    expect(result.postedFacilityCount).toBe(0);
  });

  it("scopes partial census to posted sites only (2 of 5 posted)", () => {
    const facilities = [
      { id: "site-a", total_licensed_beds: 50 },
      { id: "site-b", total_licensed_beds: 50 },
      { id: "site-c", total_licensed_beds: 50 },
      { id: "site-d", total_licensed_beds: 50 },
      { id: "site-e", total_licensed_beds: 50 },
    ];
    const census = new Map([
      ["site-a", { total_beds: 50, occupancy_count: 45 }],
      ["site-b", { total_beds: 50, occupancy_count: 40 }],
    ]);

    const result = computePortfolioOccupancyFromBedCensus(facilities, census);
    expect(result.postedFacilityCount).toBe(2);
    expect(result.totalFacilityCount).toBe(5);
    expect(result.allFacilitiesPosted).toBe(false);
    expect(result.occupancyPct).toBe(85);
  });

  it("uses the full portfolio when every facility has posted census", () => {
    const facilities = [
      { id: "site-a", total_licensed_beds: 40 },
      { id: "site-b", total_licensed_beds: 40 },
    ];
    const census = new Map([
      ["site-a", { total_beds: 40, occupancy_count: 30 }],
      ["site-b", { total_beds: 40, occupancy_count: 20 }],
    ]);

    const result = computePortfolioOccupancyFromBedCensus(facilities, census);
    expect(result.allFacilitiesPosted).toBe(true);
    expect(result.occupancyPct).toBe(62.5);
  });
});
