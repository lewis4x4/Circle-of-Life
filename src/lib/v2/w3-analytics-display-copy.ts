/**
 * Quiet Operator copy for W3 analytics when rollup metrics are absent.
 * Copy reflects real data gaps — never fabricates occupancy, risk, incidents, or readiness.
 */

export const W3_ANALYTICS_NO_OCCUPANCY_POSTED_COPY = "No occupancy posted";
export const W3_ANALYTICS_NO_RISK_POSTED_COPY = "No risk posted";
export const W3_ANALYTICS_NO_READINESS_POSTED_COPY = "No readiness posted";
export const W3_ANALYTICS_NO_INCIDENTS_POSTED_COPY = "No incidents posted";

function isFiniteW3Metric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Table occupancy % — raw number when posted (0 stays 0); explicit gap copy when missing. */
export function formatW3AnalyticsOccupancyPct(value: number | null | undefined): string {
  if (!isFiniteW3Metric(value)) return W3_ANALYTICS_NO_OCCUPANCY_POSTED_COPY;
  return String(value);
}

/** Table risk score — raw number when posted (0 stays 0); explicit gap copy when missing. */
export function formatW3AnalyticsRiskScore(value: number | null | undefined): string {
  if (!isFiniteW3Metric(value)) return W3_ANALYTICS_NO_RISK_POSTED_COPY;
  return String(value);
}

/** Table survey readiness % — raw number when posted (0 stays 0); explicit gap copy when missing. */
export function formatW3AnalyticsSurveyReadinessPct(value: number | null | undefined): string {
  if (!isFiniteW3Metric(value)) return W3_ANALYTICS_NO_READINESS_POSTED_COPY;
  return String(value);
}

/** KPI strip open-incident total — real zero stays numeric; missing names the gap. */
export function formatW3AnalyticsTotalIncidents(value: number | null | undefined): string | number {
  if (value == null) return W3_ANALYTICS_NO_INCIDENTS_POSTED_COPY;
  return value;
}

/** KPI strip average risk score — real zero stays numeric; missing names the gap. */
export function formatW3AnalyticsAvgRisk(value: number | null | undefined): string | number {
  if (value == null) return W3_ANALYTICS_NO_RISK_POSTED_COPY;
  return value;
}
