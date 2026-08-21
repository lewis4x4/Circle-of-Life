/**
 * Shared portfolio occupancy percent semantics for Executive + Facilities hubs.
 * One census → one displayed percent; never fabricates occupancy.
 */

export const PORTFOLIO_OCCUPANCY_NO_POSTED_COPY = "No occupancy posted";
export const PORTFOLIO_OCCUPANCY_FULL_LABEL = "Portfolio occupancy";
export const PORTFOLIO_OCCUPANCY_POSTED_SITES_LABEL = "Posted-sites occupancy";

export type PortfolioOccupancyScope = {
  allFacilitiesPosted: boolean;
  postedFacilityCount: number;
  totalFacilityCount: number;
};

export type PortfolioOccupancyFacilitySlice = {
  censusPosted: boolean;
  occupied: number;
  denominatorBeds: number;
};

export type PortfolioOccupancyAggregate = PortfolioOccupancyScope & {
  occupancyPct: number | null;
  postedOccupiedSum: number;
  postedDenominatorBeds: number;
};

/**
 * Portfolio headline % — posted-only denominator when census is partial;
 * full portfolio when every in-scope facility has posted census (including 0%).
 */
export function aggregatePortfolioOccupancy(
  slices: PortfolioOccupancyFacilitySlice[],
): PortfolioOccupancyAggregate {
  const totalFacilityCount = slices.length;
  const postedSlices = slices.filter((slice) => slice.censusPosted);
  const postedFacilityCount = postedSlices.length;
  const allFacilitiesPosted =
    totalFacilityCount > 0 && postedFacilityCount === totalFacilityCount;

  if (postedFacilityCount === 0) {
    return {
      occupancyPct: null,
      allFacilitiesPosted: false,
      postedFacilityCount: 0,
      totalFacilityCount,
      postedOccupiedSum: 0,
      postedDenominatorBeds: 0,
    };
  }

  const postedOccupiedSum = postedSlices.reduce((sum, slice) => sum + slice.occupied, 0);
  const postedDenominatorBeds = postedSlices.reduce((sum, slice) => sum + slice.denominatorBeds, 0);
  const denominatorBeds = allFacilitiesPosted ? postedDenominatorBeds : postedDenominatorBeds;
  const occupancyPct =
    denominatorBeds > 0 ? computePortfolioOccupancyPct(postedOccupiedSum, denominatorBeds) : null;

  return {
    occupancyPct,
    allFacilitiesPosted,
    postedFacilityCount,
    totalFacilityCount,
    postedOccupiedSum,
    postedDenominatorBeds,
  };
}

/** Headline label — must match whether the figure is portfolio-wide or posted-sites-only. */
export function resolvePortfolioOccupancyHeadlineLabel(input: {
  facilityScoped?: boolean;
  allFacilitiesPosted: boolean;
}): string {
  if (input.facilityScoped) return "This facility occupancy";
  if (input.allFacilitiesPosted) return PORTFOLIO_OCCUPANCY_FULL_LABEL;
  return PORTFOLIO_OCCUPANCY_POSTED_SITES_LABEL;
}

/** Operator footnote when the headline uses posted census only. */
export function portfolioOccupancyScopeFootnote(scope: PortfolioOccupancyScope): string | null {
  if (scope.allFacilitiesPosted || scope.postedFacilityCount === 0) return null;
  return `${scope.postedFacilityCount} of ${scope.totalFacilityCount} facilities have census posted — occupancy uses posted census only.`;
}

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
