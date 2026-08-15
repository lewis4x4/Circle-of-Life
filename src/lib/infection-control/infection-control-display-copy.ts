/**
 * Quiet Operator copy for the infection control hub (`/admin/infection-control`) KPI tiles.
 * Missing counts name real gaps — never fabricate infection or outbreak metrics.
 */

export type InfectionControlHubKpiKey =
  | "active_infections"
  | "active_outbreaks"
  | "open_vital_alerts"
  | "staff_out_sick";

const LOADING_COPY: Record<InfectionControlHubKpiKey, string> = {
  active_infections: "Loading infection count…",
  active_outbreaks: "Loading outbreak count…",
  open_vital_alerts: "Loading alert count…",
  staff_out_sick: "Loading staff-out count…",
};

const NO_COUNT_POSTED_COPY: Record<InfectionControlHubKpiKey, string> = {
  active_infections: "No infection count posted",
  active_outbreaks: "No outbreak count posted",
  open_vital_alerts: "No alert count posted",
  staff_out_sick: "No staff-out count posted",
};

/** KPI tile body — real zeros stay numeric; loading and missing counts get explicit copy. */
export function formatInfectionControlHubKpiValue(
  key: InfectionControlHubKpiKey,
  value: number | null | undefined,
  isLoading: boolean,
): string | number {
  if (isLoading) return LOADING_COPY[key];
  if (value == null) return NO_COUNT_POSTED_COPY[key];
  return value;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function infectionControlHubKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}
