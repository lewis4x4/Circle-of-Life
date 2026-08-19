/**
 * Shared portfolio occupancy percent semantics for Executive + Facilities hubs.
 * One census → one displayed percent; never fabricates occupancy.
 */

export const PORTFOLIO_OCCUPANCY_NO_POSTED_COPY = "No occupancy posted";

export function isPortfolioOccupancyPctPosted(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Portfolio occupancy % (0–100) rounded to one decimal. Real zero stays 0. */
export function computePortfolioOccupancyPct(occupied: number, denominator: number): number {
  if (denominator <= 0) return 0;
  if (occupied <= 0) return 0;
  return Math.min(100, Math.round((occupied / denominator) * 1000) / 10);
}

/** Numeric label without % — missing → named gap; 0 → 0; else one decimal. */
export function formatPortfolioOccupancyPctValue(value: number | null | undefined): string {
  if (!isPortfolioOccupancyPctPosted(value)) return PORTFOLIO_OCCUPANCY_NO_POSTED_COPY;
  if (value === 0) return "0";
  return value.toFixed(1);
}

/** Display string with % suffix — missing → named gap; 0 → 0%; else one decimal + %. */
export function formatPortfolioOccupancyPctDisplay(value: number | null | undefined): string {
  if (!isPortfolioOccupancyPctPosted(value)) return PORTFOLIO_OCCUPANCY_NO_POSTED_COPY;
  if (value === 0) return "0%";
  return `${value.toFixed(1)}%`;
}
