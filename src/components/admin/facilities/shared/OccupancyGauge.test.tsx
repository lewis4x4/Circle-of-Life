import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  computePortfolioOccupancyPct,
  formatPortfolioOccupancyPctDisplay,
} from "@/lib/occupancy/portfolio-occupancy-display";

import { OccupancyGauge } from "./OccupancyGauge";

describe("OccupancyGauge portfolio semantics", () => {
  it("matches KPI strip display for non-integer occupancy ratios", () => {
    const occupied = 33;
    const total = 258;
    const stripLabel = formatPortfolioOccupancyPctDisplay(
      computePortfolioOccupancyPct(occupied, total),
    );

    render(<OccupancyGauge occupied={occupied} total={total} portfolioSemantics />);

    expect(screen.getByText(stripLabel)).toBeInTheDocument();
    expect(stripLabel).toBe("12.8%");
    expect(screen.queryByText("13%")).not.toBeInTheDocument();
  });

  it("keeps real zero as 0% when census is loaded", () => {
    render(<OccupancyGauge occupied={0} total={258} portfolioSemantics />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
