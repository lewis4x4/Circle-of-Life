import { describe, expect, it } from "vitest";

import {
  PORTFOLIO_OCCUPANCY_NO_POSTED_COPY,
  computePortfolioOccupancyPct,
  formatPortfolioOccupancyPctDisplay,
  formatPortfolioOccupancyPctValue,
} from "./portfolio-occupancy-display";
import {
  formatExecutiveOccupancyBarLabel,
  formatExecutiveOccupancyPctWithSuffix,
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
      comparison: [],
    };
    expect(portfolioStripPortfolioOccupancyDisplay(unloadedTotals)).toBe(PORTFOLIO_OCCUPANCY_NO_POSTED_COPY);
  });
});
