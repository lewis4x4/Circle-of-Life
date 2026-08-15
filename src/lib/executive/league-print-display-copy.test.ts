import { describe, expect, it } from "vitest";

import {
  LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY,
  LEAGUE_PRINT_NO_OCCUPANCY_POSTED_COPY,
  LEAGUE_PRINT_NO_RISK_POSTED_COPY,
  formatLeaguePrintConfidenceBand,
  formatLeaguePrintOccupancyPct,
  formatLeaguePrintRiskScore,
} from "./league-print-display-copy";

describe("formatLeaguePrintRiskScore", () => {
  it("names the gap when risk score is missing", () => {
    expect(formatLeaguePrintRiskScore(null)).toBe(LEAGUE_PRINT_NO_RISK_POSTED_COPY);
    expect(formatLeaguePrintRiskScore(undefined)).toBe(LEAGUE_PRINT_NO_RISK_POSTED_COPY);
  });

  it("keeps real zero as 0/100", () => {
    expect(formatLeaguePrintRiskScore(0)).toBe("0/100");
  });

  it("formats posted positive risk scores", () => {
    expect(formatLeaguePrintRiskScore(42)).toBe("42/100");
  });
});

describe("formatLeaguePrintOccupancyPct", () => {
  it("names the gap when occupancy is missing", () => {
    expect(formatLeaguePrintOccupancyPct(null)).toBe(LEAGUE_PRINT_NO_OCCUPANCY_POSTED_COPY);
    expect(formatLeaguePrintOccupancyPct(undefined)).toBe(LEAGUE_PRINT_NO_OCCUPANCY_POSTED_COPY);
  });

  it("keeps real zero as 0%", () => {
    expect(formatLeaguePrintOccupancyPct(0)).toBe("0%");
  });

  it("formats posted positive occupancy values", () => {
    expect(formatLeaguePrintOccupancyPct(87)).toBe("87%");
  });
});

describe("formatLeaguePrintConfidenceBand", () => {
  it("names the gap when confidence band is missing or blank", () => {
    expect(formatLeaguePrintConfidenceBand(null)).toBe(LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY);
    expect(formatLeaguePrintConfidenceBand(undefined)).toBe(LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY);
    expect(formatLeaguePrintConfidenceBand("")).toBe(LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY);
    expect(formatLeaguePrintConfidenceBand("   ")).toBe(LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY);
  });

  it("returns posted confidence band trimmed", () => {
    expect(formatLeaguePrintConfidenceBand("high")).toBe("high");
    expect(formatLeaguePrintConfidenceBand("  medium  ")).toBe("medium");
  });
});
