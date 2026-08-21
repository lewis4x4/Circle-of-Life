/**
 * Quiet Operator copy for executive KPI tiles when snapshot metrics are absent.
 * Copy reflects real data gaps — never fabricates values or readiness scores.
 */

import type { PortfolioOccupancyAggregate } from "@/lib/occupancy/portfolio-occupancy-display";
import { portfolioOccupancyScopeFootnote } from "@/lib/occupancy/portfolio-occupancy-display";
import type { PortfolioOccupancyScope } from "@/lib/occupancy/portfolio-occupancy-display";

export type ExecutiveKpiMetricKey =
  | "occ_pt"
  | "rev_mtd"
  | "labor_pct"
  | "inc_rate"
  | "survey_rd";

export type OccupancyContext = {
  occupiedResidents: number;
  licensedBeds: number;
  occupancyPct: number | null;
} & PortfolioOccupancyScope;

const EMPTY_COPY: Record<ExecutiveKpiMetricKey, string> = {
  occ_pt: "No census loaded yet",
  rev_mtd: "No billed revenue this period",
  labor_pct: "No payroll loaded this period",
  inc_rate: "No incident rate yet",
  survey_rd: "No survey on file",
};

/** One-line reason a KPI tile is empty instead of showing a value. */
export function executiveKpiEmptyCopy(metricKey: ExecutiveKpiMetricKey): string {
  return EMPTY_COPY[metricKey];
}

export function buildOccupancyContextFromPortfolioAggregate(
  portfolioOccupancy: PortfolioOccupancyAggregate,
  allLicensedBeds: number,
): OccupancyContext | null {
  if (portfolioOccupancy.postedFacilityCount === 0) return null;
  return {
    occupiedResidents: portfolioOccupancy.postedOccupiedSum,
    licensedBeds: portfolioOccupancy.allFacilitiesPosted
      ? allLicensedBeds
      : portfolioOccupancy.postedDenominatorBeds,
    occupancyPct: portfolioOccupancy.occupancyPct,
    allFacilitiesPosted: portfolioOccupancy.allFacilitiesPosted,
    postedFacilityCount: portfolioOccupancy.postedFacilityCount,
    totalFacilityCount: portfolioOccupancy.totalFacilityCount,
  };
}

export function occupancyContextOccPtFraction(context: OccupancyContext | null): number | undefined {
  if (!context || context.occupancyPct == null) return undefined;
  return context.occupancyPct / 100;
}

/** Short qualifier when occupancy is present — scopes partial census honestly. */
export function occupancyLoadedFootnote(context: OccupancyContext): string | null {
  const scopeFootnote = portfolioOccupancyScopeFootnote(context);
  if (scopeFootnote) return scopeFootnote;
  const { occupiedResidents, licensedBeds } = context;
  if (occupiedResidents <= 0 || licensedBeds <= 0) return null;
  return `${occupiedResidents} in census · ${licensedBeds} licensed beds`;
}

/** Summary line under the KPI strip — makes loaded vs empty tiles obvious at a glance. */
export function executiveKpiStripHelperLine(
  loadedCount: number,
  totalCount: number,
): string {
  if (loadedCount >= totalCount) {
    return "All KPIs loaded from the latest executive snapshot.";
  }
  if (loadedCount === 0) {
    return "Empty tiles name what is still missing — nothing is broken.";
  }
  return `${loadedCount} of ${totalCount} KPIs loaded — empty tiles name what is still missing.`;
}
