/**
 * Quiet Operator copy for the admin quality hub (`/admin/quality`).
 * Empty states name real gaps — never fabricate measure names, units, values, or counts.
 */

export const QUALITY_HUB_NO_UNIT_COPY = "No unit posted";
export const QUALITY_HUB_MEASURE_NAME_NOT_POSTED = "Measure name not posted";
export const QUALITY_HUB_NO_PERIOD_START_COPY = "No start date posted";
export const QUALITY_HUB_NO_PERIOD_END_COPY = "No end date posted";
export const QUALITY_HUB_NO_VALUE_COPY = "No value posted";
export const QUALITY_HUB_ROW_COUNT_NOT_POSTED = "Row count not posted";

export type QualityHubMetricContext = {
  noFacility: boolean;
  loading: boolean;
};

/** Metric strip when the header facility selector has no valid site. */
export function qualityHubMetricNoFacilityCopy(): string {
  return "Select a facility";
}

/** Metric strip while hub data is in flight. */
export function qualityHubMetricLoadingCopy(): string {
  return "Loading…";
}

/** Resolve a hub KPI tile value — real zeros stay numeric once loaded. */
export function qualityHubMetricValue(
  value: number,
  ctx: QualityHubMetricContext,
): string | number {
  if (ctx.noFacility) return qualityHubMetricNoFacilityCopy();
  if (ctx.loading) return qualityHubMetricLoadingCopy();
  return value;
}

/** Catalog or telemetry measure name — never invents a label from measure id. */
export function formatQualityHubMeasureName(name: string | null | undefined): string {
  if (!name || !name.trim()) return QUALITY_HUB_MEASURE_NAME_NOT_POSTED;
  return name;
}

/** Catalog measure unit when the field is unset. */
export function formatQualityHubMeasureUnit(unit: string | null | undefined): string {
  if (!unit || !unit.trim()) return QUALITY_HUB_NO_UNIT_COPY;
  return unit;
}

/** Reporting period start on a telemetry row. */
export function formatQualityHubPeriodStart(periodStart: string | null | undefined): string {
  if (!periodStart || !periodStart.trim()) return QUALITY_HUB_NO_PERIOD_START_COPY;
  return periodStart;
}

/** Reporting period end on a telemetry row. */
export function formatQualityHubPeriodEnd(periodEnd: string | null | undefined): string {
  if (!periodEnd || !periodEnd.trim()) return QUALITY_HUB_NO_PERIOD_END_COPY;
  return periodEnd;
}

/** Latest telemetry value — real numeric zero stays zero. */
export function formatQualityHubResultValue(
  valueNumeric: number | null | undefined,
  valueText: string | null | undefined,
): string {
  if (valueNumeric != null) return String(valueNumeric);
  if (valueText && valueText.trim()) return valueText;
  return QUALITY_HUB_NO_VALUE_COPY;
}

/** PBJ batch row count when the field is unset. */
export function formatQualityHubPbjRowCount(rowCount: number | null | undefined): string {
  if (rowCount == null) return QUALITY_HUB_ROW_COUNT_NOT_POSTED;
  return String(rowCount);
}
