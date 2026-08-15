import { describe, expect, it } from "vitest";

import {
  aggregateBedCensusByFacility,
  computeFacilityOccupancyPct,
  isFacilityOccupancyCensusLoaded,
} from "./facility-occupancy-census";

const oakridge = { id: "oakridge", total_licensed_beds: 52 };
const homewood = { id: "homewood", total_licensed_beds: 48 };

describe("facility occupancy census honesty", () => {
  it("treats unloaded facilities as missing census", () => {
    expect(isFacilityOccupancyCensusLoaded(homewood, undefined)).toBe(false);
    expect(computeFacilityOccupancyPct(homewood, undefined)).toBeNull();
  });

  it("keeps loaded empty facilities at 0%", () => {
    const census = aggregateBedCensusByFacility([
      { facility_id: "oakridge", current_resident_id: null },
      { facility_id: "oakridge", current_resident_id: null },
    ]);

    expect(isFacilityOccupancyCensusLoaded(oakridge, census.get("oakridge"))).toBe(true);
    expect(computeFacilityOccupancyPct(oakridge, census.get("oakridge"))).toBe(0);
  });

  it("computes occupied facility percent from bed grid", () => {
    const census = aggregateBedCensusByFacility([
      { facility_id: "oakridge", current_resident_id: "resident-1" },
      { facility_id: "oakridge", current_resident_id: null },
      { facility_id: "oakridge", current_resident_id: "resident-2" },
      { facility_id: "oakridge", current_resident_id: null },
    ]);

    expect(computeFacilityOccupancyPct(oakridge, census.get("oakridge"))).toBe(50);
  });
});
