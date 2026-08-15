/**
 * Quiet Operator copy for executive KPI tiles when snapshot metrics are absent.
 * Copy reflects real data gaps — never fabricates values or readiness scores.
 */

export type ExecutiveKpiMetricKey =
  | "occ_pt"
  | "rev_mtd"
  | "labor_pct"
  | "inc_rate"
  | "survey_rd";

export type OccupancyContext = {
  occupiedResidents: number;
  licensedBeds: number;
};

const EMPTY_COPY: Record<ExecutiveKpiMetricKey, string> = {
  occ_pt: "No occupancy snapshot yet",
  rev_mtd: "No billed revenue this period",
  labor_pct: "No payroll loaded this period",
  inc_rate: "No incident rate yet",
  survey_rd: "No survey on file",
};

/** One-line reason a KPI tile is empty instead of showing a value. */
export function executiveKpiEmptyCopy(metricKey: ExecutiveKpiMetricKey): string {
  return EMPTY_COPY[metricKey];
}

/** Short qualifier when occupancy is present but looks low vs licensed capacity. */
export function occupancyLoadedFootnote(context: OccupancyContext): string | null {
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
