/**
 * Quiet Operator copy for the discharge med reconciliation hub KPI tiles.
 * Missing counts name real gaps — never fabricate pipeline metrics.
 */

export type DischargeMedRecHubKpiKey =
  | "planning_gaps"
  | "pharmacist_review"
  | "ready_to_complete";

const LOADING_COPY: Record<DischargeMedRecHubKpiKey, string> = {
  planning_gaps: "Loading planning gaps count…",
  pharmacist_review: "Loading external pharmacist review count…",
  ready_to_complete: "Loading ready to complete count…",
};

const NO_COUNT_POSTED_COPY: Record<DischargeMedRecHubKpiKey, string> = {
  planning_gaps: "No planning gaps count posted",
  pharmacist_review: "No external pharmacist review count posted",
  ready_to_complete: "No ready to complete count posted",
};

/** KPI tile body — real zeros stay numeric; loading and missing counts get explicit copy. */
export function formatDischargeMedRecHubKpiValue(
  key: DischargeMedRecHubKpiKey,
  value: number | null | undefined,
  isLoading: boolean,
): string | number {
  if (isLoading) return LOADING_COPY[key];
  if (value == null) return NO_COUNT_POSTED_COPY[key];
  return value;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function dischargeMedRecHubKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}
