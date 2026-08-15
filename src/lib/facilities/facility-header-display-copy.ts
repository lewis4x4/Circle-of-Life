/**
 * Quiet Operator copy for the facility detail overview KPI strip ({@link FacilityOverviewMetricsStrip}).
 * Missing labor share and survey readiness name real gaps — never fabricate percentages.
 */

export const FACILITY_HEADER_NO_LABOR_SHARE_COPY = "No labor share posted";
export const FACILITY_HEADER_NO_READINESS_COPY = "No readiness posted";

export function isFiniteFacilityHeaderMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Labor cost MTD share of census revenue — real zero stays `0%`; missing gets explicit copy. */
export function formatFacilityHeaderLaborSharePct(value: number | null | undefined): string {
  if (!isFiniteFacilityHeaderMetric(value)) return FACILITY_HEADER_NO_LABOR_SHARE_COPY;
  return `${Math.round(value)}%`;
}

/** Survey readiness percent — real zero stays `0%`; missing gets explicit copy. */
export function formatFacilityHeaderSurveyReadinessPct(value: number | null | undefined): string {
  if (!isFiniteFacilityHeaderMetric(value)) return FACILITY_HEADER_NO_READINESS_COPY;
  return `${Math.round(value)}%`;
}
