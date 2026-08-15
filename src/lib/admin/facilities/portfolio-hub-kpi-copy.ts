/**
 * Quiet Operator copy for the facilities portfolio hub when KPIs or card fields are absent.
 * Copy reflects real data gaps — never fabricates occupancy, survey scores, or bed counts.
 */

import type { FacilityRow } from "@/types/facility";

import { portfolioOccupancyPercent } from "./portfolio-metrics";

export type PortfolioStripKpiKey =
  | "facility_count"
  | "licensed_beds"
  | "occupied_beds"
  | "portfolio_occupancy";

export type PortfolioFacilityCardFieldKey =
  | "occupancy"
  | "survey_readiness"
  | "labor_mtd"
  | "location";

export type PortfolioComparisonEntry = {
  id: string;
  name: string;
  occupancyPct: number;
  occupancyLoaded: boolean;
};

/** Licensed capacity when the facility row has a positive total on file. */
export function facilityLicensedBedsOnFile(facility: FacilityRow): number | null {
  const raw =
    typeof facility.total_licensed_beds === "number"
      ? facility.total_licensed_beds
      : facility.licensed_beds;
  if (typeof raw === "number" && raw > 0) return raw;
  return null;
}

/** Bed census is loaded when the bed grid exists or occupied count is non-zero. */
export function facilityOccupancyLoaded(facility: FacilityRow): boolean {
  const phy = facility.total_beds ?? 0;
  const occ = facility.occupancy_count ?? facility.current_occupancy ?? 0;
  return phy > 0 || occ > 0;
}

export function facilityOccupiedCount(facility: FacilityRow): number {
  return facility.occupancy_count ?? facility.current_occupancy ?? 0;
}

export function facilityOccupancyDenominator(facility: FacilityRow): number {
  const phy = facility.total_beds ?? 0;
  const licensed = facilityLicensedBedsOnFile(facility) ?? 0;
  if (phy > 0) return phy;
  return licensed;
}

/** Portfolio occupancy % for comparison bars — null when census is not loaded. */
export function facilityPortfolioOccupancyPct(facility: FacilityRow): number | null {
  if (!facilityOccupancyLoaded(facility)) return null;
  const occ = facilityOccupiedCount(facility);
  const phy = facility.total_beds ?? 0;
  const licensed = facilityLicensedBedsOnFile(facility) ?? 0;
  return portfolioOccupancyPercent(occ, phy, licensed);
}

const STRIP_EMPTY_COPY: Record<PortfolioStripKpiKey, string> = {
  facility_count: "No facilities in scope",
  licensed_beds: "Licensed beds not on file",
  occupied_beds: "Census not loaded yet",
  portfolio_occupancy: "No occupancy loaded",
};

const CARD_EMPTY_COPY: Record<PortfolioFacilityCardFieldKey, string> = {
  occupancy: "Census not loaded yet",
  survey_readiness: "No survey on file",
  labor_mtd: "No payroll loaded this period",
  location: "Location not on file",
};

export type PortfolioStripTotals = {
  facilityCount: number;
  licensedSum: number;
  licensedLoaded: boolean;
  occupiedSum: number;
  occupiedLoaded: boolean;
  portfolioPctRounded: number | null;
  portfolioPctLoaded: boolean;
  comparison: PortfolioComparisonEntry[];
};

/** Aggregate portfolio strip inputs from accessible facility rows. */
export function buildPortfolioStripTotals(facilities: FacilityRow[]): PortfolioStripTotals {
  let licensedSum = 0;
  let licensedLoaded = false;
  let occupiedSum = 0;
  let occupiedLoaded = false;
  const comparison: PortfolioComparisonEntry[] = [];

  for (const facility of facilities) {
    const lic = facilityLicensedBedsOnFile(facility);
    if (lic != null) {
      licensedSum += lic;
      licensedLoaded = true;
    }

    if (facilityOccupancyLoaded(facility)) {
      occupiedSum += facilityOccupiedCount(facility);
      occupiedLoaded = true;
    }

    const occupancyPct = facilityPortfolioOccupancyPct(facility);
    comparison.push({
      id: facility.id,
      name: facility.name,
      occupancyPct: occupancyPct ?? 0,
      occupancyLoaded: occupancyPct != null,
    });
  }

  let portfolioPctRounded: number | null = null;
  let portfolioPctLoaded = false;
  const censusCompleteForLicensed = facilities
    .filter((f) => facilityLicensedBedsOnFile(f) != null)
    .every((f) => facilityOccupancyLoaded(f));
  if (licensedLoaded && licensedSum > 0 && occupiedLoaded && censusCompleteForLicensed) {
    portfolioPctRounded = Math.min(100, Math.round((occupiedSum / licensedSum) * 100));
    portfolioPctLoaded = true;
  }

  return {
    facilityCount: facilities.length,
    licensedSum,
    licensedLoaded,
    occupiedSum,
    occupiedLoaded,
    portfolioPctRounded,
    portfolioPctLoaded,
    comparison,
  };
}

/** One-line reason a portfolio strip tile is empty instead of showing a value. */
export function portfolioStripKpiEmptyCopy(key: PortfolioStripKpiKey): string {
  return STRIP_EMPTY_COPY[key];
}

export function portfolioStripFacilityCountEmptyCopy(facilityCount: number): string | null {
  if (facilityCount > 0) return null;
  return STRIP_EMPTY_COPY.facility_count;
}

export function portfolioStripLicensedBedsEmptyCopy(totals: PortfolioStripTotals): string | null {
  if (totals.licensedLoaded) return null;
  return STRIP_EMPTY_COPY.licensed_beds;
}

export function portfolioStripOccupiedBedsEmptyCopy(totals: PortfolioStripTotals): string | null {
  if (totals.occupiedLoaded) return null;
  return STRIP_EMPTY_COPY.occupied_beds;
}

export function portfolioStripPortfolioOccupancyEmptyCopy(totals: PortfolioStripTotals): string | null {
  if (totals.portfolioPctLoaded && totals.portfolioPctRounded != null) return null;
  return STRIP_EMPTY_COPY.portfolio_occupancy;
}

export function portfolioStripKpiIsLoaded(key: PortfolioStripKpiKey, totals: PortfolioStripTotals): boolean {
  switch (key) {
    case "facility_count":
      return portfolioStripFacilityCountEmptyCopy(totals.facilityCount) == null;
    case "licensed_beds":
      return portfolioStripLicensedBedsEmptyCopy(totals) == null;
    case "occupied_beds":
      return portfolioStripOccupiedBedsEmptyCopy(totals) == null;
    case "portfolio_occupancy":
      return portfolioStripPortfolioOccupancyEmptyCopy(totals) == null;
  }
}

/** One-line reason a facility card field is empty instead of showing a metric or em-dash. */
export function portfolioFacilityCardFieldEmptyCopy(
  key: PortfolioFacilityCardFieldKey,
  facility: FacilityRow,
): string | null {
  switch (key) {
    case "occupancy":
      return facilityOccupancyLoaded(facility) ? null : CARD_EMPTY_COPY.occupancy;
    case "survey_readiness":
      if (
        facility.survey_readiness_pct != null &&
        Number.isFinite(facility.survey_readiness_pct)
      ) {
        return null;
      }
      return CARD_EMPTY_COPY.survey_readiness;
    case "labor_mtd":
      if (facility.labor_cost_mtd_pct != null && Number.isFinite(facility.labor_cost_mtd_pct)) {
        return null;
      }
      return CARD_EMPTY_COPY.labor_mtd;
    case "location":
      const city = facility.city ?? "";
      const county = facility.county ?? "";
      if (city.trim() || county.trim()) return null;
      return CARD_EMPTY_COPY.location;
  }
}

/** Comparison row label when occupancy is not loaded for one facility. */
export function portfolioComparisonOccupancyEmptyCopy(): string {
  return CARD_EMPTY_COPY.occupancy;
}

/** Summary line under the portfolio KPI strip. */
export function portfolioKpiStripHelperLine(totals: PortfolioStripTotals): string {
  const keys: PortfolioStripKpiKey[] = [
    "facility_count",
    "licensed_beds",
    "occupied_beds",
    "portfolio_occupancy",
  ];
  const loadedCount = keys.filter((key) => portfolioStripKpiIsLoaded(key, totals)).length;
  const totalCount = keys.length;

  if (loadedCount >= totalCount) {
    return "Portfolio snapshot loaded — open a facility card for licensing, census, and survey context without opening a resident record.";
  }
  if (loadedCount === 0) {
    return "Empty tiles name what is still missing — nothing is broken.";
  }
  return `${loadedCount} of ${totalCount} portfolio tiles loaded — empty tiles name what is still missing.`;
}

/** Helper when every comparison bar is waiting on census. */
export function portfolioComparisonHelperLine(entries: PortfolioComparisonEntry[]): string | null {
  if (entries.length === 0) return null;
  const loadedCount = entries.filter((e) => e.occupancyLoaded).length;
  if (loadedCount === 0) {
    return "Occupancy bars appear when bed census is loaded per site.";
  }
  if (loadedCount < entries.length) {
    return `${loadedCount} of ${entries.length} facilities have census loaded — others name the gap inline.`;
  }
  return null;
}
