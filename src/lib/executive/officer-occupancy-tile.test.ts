import { describe, expect, it } from "vitest";

import {
  formatExecutiveOccupancyPctWithSuffix,
  resolveOfficerOccupancyTileLabel,
} from "@/lib/executive/executive-display-copy";
import { computePortfolioOccupancyPct } from "@/lib/occupancy/portfolio-occupancy-display";

describe("resolveOfficerOccupancyTileLabel", () => {
  it("names portfolio scope when the board is not facility-scoped", () => {
    expect(resolveOfficerOccupancyTileLabel(false)).toBe("Portfolio occupancy");
  });

  it("names this-facility scope when the header selects a facility", () => {
    expect(resolveOfficerOccupancyTileLabel(true)).toBe("This facility occupancy");
  });
});

describe("officer occupancy tile scope alignment", () => {
  const portfolioPct = computePortfolioOccupancyPct(33, 258);
  const facilityPct = 91.7;

  it("portfolio label cannot pair with a facility-only percent", () => {
    const label = resolveOfficerOccupancyTileLabel(false);
    const value = formatExecutiveOccupancyPctWithSuffix(portfolioPct);

    expect(label).toBe("Portfolio occupancy");
    expect(value).toBe("12.8%");
    expect(value).not.toBe(formatExecutiveOccupancyPctWithSuffix(facilityPct));
  });

  it("this-facility label cannot pair with a portfolio percent badge", () => {
    const label = resolveOfficerOccupancyTileLabel(true);
    const value = formatExecutiveOccupancyPctWithSuffix(facilityPct);

    expect(label).toBe("This facility occupancy");
    expect(label).not.toBe("Portfolio occupancy");
    expect(value).toBe("91.7%");
    expect(value).not.toBe(formatExecutiveOccupancyPctWithSuffix(portfolioPct));
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
