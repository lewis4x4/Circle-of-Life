import type { FacilityDetailRow } from "@/types/facility";
import { facilityOccupancyLoaded } from "@/lib/admin/facilities/portfolio-hub-kpi-copy";
import {
  computePortfolioOccupancyPct,
  formatPortfolioOccupancyPctDisplay,
} from "@/lib/occupancy/portfolio-occupancy-display";

/** Portfolio occupancy % for the overview census line — null when census is not loaded. */
export function overviewTabOccupancyPctValue(
  facility: FacilityDetailRow,
  bedsLoadedCount: number,
  occupiedBeds: number,
  denomBeds: number,
): number | null {
  const censusLoaded = facilityOccupancyLoaded(facility) || bedsLoadedCount > 0;
  if (!censusLoaded) return null;
  return computePortfolioOccupancyPct(occupiedBeds, denomBeds);
}

export function overviewTabOccupancyDisplay(
  facility: FacilityDetailRow,
  bedsLoadedCount: number,
  occupiedBeds: number,
  denomBeds: number,
): string {
  return formatPortfolioOccupancyPctDisplay(
    overviewTabOccupancyPctValue(facility, bedsLoadedCount, occupiedBeds, denomBeds),
  );
}

/** OccupancyGauge portfolioSemantics center label for the same census inputs. */
export function overviewTabOccupancyGaugeLabel(occupiedBeds: number, denomBeds: number): string {
  return formatPortfolioOccupancyPctDisplay(computePortfolioOccupancyPct(occupiedBeds, denomBeds));
}
