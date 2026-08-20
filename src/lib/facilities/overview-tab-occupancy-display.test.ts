import { describe, expect, it } from "vitest";

import type { FacilityDetailRow } from "@/types/facility";
import { PORTFOLIO_OCCUPANCY_NO_POSTED_COPY } from "@/lib/occupancy/portfolio-occupancy-display";

import {
  overviewTabOccupancyDisplay,
  overviewTabOccupancyGaugeLabel,
  overviewTabOccupancyPctValue,
} from "./overview-tab-occupancy-display";

function facility(partial: Partial<FacilityDetailRow> & Pick<FacilityDetailRow, "id" | "name">): FacilityDetailRow {
  return {
    organization_id: "org-1",
    ...partial,
  } as FacilityDetailRow;
}

describe("overview tab occupancy display", () => {
  it("occupancy line matches gauge portfolio label for the same census", () => {
    const occupied = 33;
    const denom = 258;
    const loaded = facility({
      id: "1",
      name: "Oakridge",
      total_beds: denom,
      occupancy_count: occupied,
    });

    const line = overviewTabOccupancyDisplay(loaded, 0, occupied, denom);
    const gauge = overviewTabOccupancyGaugeLabel(occupied, denom);

    expect(line).toBe(gauge);
    expect(line).toBe("12.8%");
    expect(line).not.toBe("13%");
  });

  it("keeps missing census as a named gap, not 0.0%", () => {
    const unloaded = facility({
      id: "1",
      name: "Oakridge",
      total_licensed_beds: 52,
      total_beds: 0,
      occupancy_count: 0,
    });

    expect(overviewTabOccupancyDisplay(unloaded, 0, 0, 52)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);
    expect(overviewTabOccupancyPctValue(unloaded, 0, 0, 52)).toBeNull();
  });

  it("keeps real posted zero as 0%", () => {
    const loadedZero = facility({
      id: "1",
      name: "Oakridge",
      total_beds: 48,
      total_licensed_beds: 52,
      occupancy_count: 0,
    });

    expect(overviewTabOccupancyDisplay(loadedZero, 0, 0, 52)).toBe("0%");
    expect(overviewTabOccupancyPctValue(loadedZero, 0, 0, 52)).toBe(0);
  });

  it("treats bed-grid load as loaded census even when facility row counts are zero", () => {
    const unloadedRow = facility({
      id: "1",
      name: "Oakridge",
      total_beds: 0,
      occupancy_count: 0,
      total_licensed_beds: 52,
    });

    expect(overviewTabOccupancyDisplay(unloadedRow, 48, 0, 52)).toBe("0%");
  });
});
