import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_OCCUPANCY_FULL_LABEL,
  PORTFOLIO_OCCUPANCY_NO_POSTED_COPY,
  PORTFOLIO_OCCUPANCY_POSTED_SITES_LABEL,
  aggregatePortfolioOccupancy,
  computePortfolioOccupancyPct,
  formatPortfolioOccupancyPctDisplay,
  formatPortfolioOccupancyPctValue,
  portfolioOccupancyScopeFootnote,
  resolvePortfolioOccupancyHeadlineLabel,
} from "./portfolio-occupancy-display";
import {
  formatExecutiveOccupancyBarLabel,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOccPtPctWithSuffix,
} from "@/lib/executive/executive-display-copy";
import { portfolioStripPortfolioOccupancyDisplay } from "@/lib/admin/facilities/portfolio-hub-kpi-copy";
import type { PortfolioStripTotals } from "@/lib/admin/facilities/portfolio-hub-kpi-copy";

describe("computePortfolioOccupancyPct", () => {
  it("keeps real zero when census is empty", () => {
    expect(computePortfolioOccupancyPct(0, 258)).toBe(0);
  });

  it("rounds non-integer ratios to one decimal percent", () => {
    expect(computePortfolioOccupancyPct(33, 258)).toBe(12.8);
  });
});

describe("aggregatePortfolioOccupancy", () => {
  const postedSite = (occupied: number, denominatorBeds: number) => ({
    censusPosted: true,
    occupied,
    denominatorBeds,
  });

  const missingSite = () => ({
    censusPosted: false,
    occupied: 0,
    denominatorBeds: 0,
  });

  it("names the gap when no facilities have posted census", () => {
    const result = aggregatePortfolioOccupancy([
      missingSite(),
      missingSite(),
      missingSite(),
    ]);
    expect(result.occupancyPct).toBeNull();
    expect(result.postedFacilityCount).toBe(0);
    expect(result.totalFacilityCount).toBe(3);
    expect(result.allFacilitiesPosted).toBe(false);
  });

  it("scopes the denominator to posted sites when census is partial (2 of 5 posted)", () => {
    const result = aggregatePortfolioOccupancy([
      postedSite(45, 50),
      postedSite(38, 50),
      missingSite(),
      missingSite(),
      missingSite(),
    ]);
    expect(result.postedFacilityCount).toBe(2);
    expect(result.totalFacilityCount).toBe(5);
    expect(result.allFacilitiesPosted).toBe(false);
    expect(result.postedOccupiedSum).toBe(83);
    expect(result.postedDenominatorBeds).toBe(100);
    expect(result.occupancyPct).toBe(83);
  });

  it("uses the full portfolio when every facility has posted census", () => {
    const result = aggregatePortfolioOccupancy([
      postedSite(40, 50),
      postedSite(30, 50),
      postedSite(0, 50),
    ]);
    expect(result.allFacilitiesPosted).toBe(true);
    expect(result.occupancyPct).toBe(46.7);
  });

  it("keeps posted-empty sites at 0% when all facilities are posted", () => {
    const result = aggregatePortfolioOccupancy([postedSite(0, 50), postedSite(0, 40)]);
    expect(result.allFacilitiesPosted).toBe(true);
    expect(result.occupancyPct).toBe(0);
  });
});

describe("resolvePortfolioOccupancyHeadlineLabel", () => {
  it("uses portfolio label when every facility is posted", () => {
    expect(resolvePortfolioOccupancyHeadlineLabel({ allFacilitiesPosted: true })).toBe(
      PORTFOLIO_OCCUPANCY_FULL_LABEL,
    );
  });

  it("uses posted-sites label when census is partial", () => {
    expect(resolvePortfolioOccupancyHeadlineLabel({ allFacilitiesPosted: false })).toBe(
      PORTFOLIO_OCCUPANCY_POSTED_SITES_LABEL,
    );
  });
});

describe("portfolioOccupancyScopeFootnote", () => {
  it("explains partial census scope with posted vs total counts", () => {
    expect(
      portfolioOccupancyScopeFootnote({
        allFacilitiesPosted: false,
        postedFacilityCount: 2,
        totalFacilityCount: 5,
      }),
    ).toBe(
      "2 of 5 facilities have census posted — occupancy uses posted census only.",
    );
  });

  it("returns null when every facility has census posted", () => {
    expect(
      portfolioOccupancyScopeFootnote({
        allFacilitiesPosted: true,
        postedFacilityCount: 5,
        totalFacilityCount: 5,
      }),
    ).toBeNull();
  });
});

describe("formatPortfolioOccupancyPctDisplay", () => {
  it("names the gap when occupancy is missing", () => {
    expect(formatPortfolioOccupancyPctDisplay(null)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);
    expect(formatPortfolioOccupancyPctDisplay(undefined)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);
  });

  it("keeps real zero as 0%", () => {
    expect(formatPortfolioOccupancyPctDisplay(0)).toBe("0%");
  });

  it("formats posted occupancy with one decimal", () => {
    expect(formatPortfolioOccupancyPctDisplay(12.8)).toBe("12.8%");
    expect(formatPortfolioOccupancyPctDisplay(82.456)).toBe("82.5%");
  });
});

describe("formatPortfolioOccupancyPctValue", () => {
  it("keeps real zero as 0 without suffix", () => {
    expect(formatPortfolioOccupancyPctValue(0)).toBe("0");
  });
});

describe("executive and facilities portfolio occupancy display parity", () => {
  it("renders the same string for the same posted percent", () => {
    const posted = computePortfolioOccupancyPct(33, 258);
    expect(formatExecutiveOccupancyPctWithSuffix(posted)).toBe(formatPortfolioOccupancyPctDisplay(posted));
    expect(formatExecutiveOccupancyBarLabel(posted)).toBe(formatPortfolioOccupancyPctDisplay(posted));
  });

  it("renders the same posted zero for executive occ_pt and facilities portfolio display", () => {
    expect(formatExecutiveOccPtPctWithSuffix(0)).toBe(formatPortfolioOccupancyPctDisplay(0));
    expect(formatExecutiveOccPtPctWithSuffix(0)).not.toBe("0.0%");
  });

  it("names the same gap when occupancy is unloaded", () => {
    expect(formatExecutiveOccupancyPctWithSuffix(null)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);

    const unloadedTotals: PortfolioStripTotals = {
      facilityCount: 1,
      licensedSum: 0,
      licensedLoaded: false,
      occupiedSum: 0,
      occupiedLoaded: false,
      portfolioPctRounded: null,
      portfolioPctLoaded: false,
      postedFacilityCount: 0,
      allFacilitiesPosted: false,
      comparison: [],
    };
    expect(portfolioStripPortfolioOccupancyDisplay(unloadedTotals)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);
  });
});
