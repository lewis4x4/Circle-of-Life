/** Query completeness is not an attestation that all source activity was recorded. */
export type StandupSourceQuality = {
  kind: "source_quality";
  version: 1;
  calculated_at: string;
  source_as_of: string | null;
  received_at: string | null;
  query_complete: boolean;
  period_coverage: "unconfirmed";
  expected_facility_ids: string[] | null;
  contributing_facility_ids: string[];
  basis: "haven_live_v1" | "haven_live_v2" | "manual" | "mixed" | "unknown";
};

type QualityMetric = { key?: string; valueType?: string; sourceRefJson?: unknown; valueNumeric?: number | null; valueText?: string | null };
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string" && id.trim().length > 0) && new Set(value).size === value.length;

export function readStandupSourceQuality(metric: QualityMetric | null | undefined): StandupSourceQuality | null {
  if (!Array.isArray(metric?.sourceRefJson)) return null;
  const entries = metric.sourceRefJson.filter((value): value is Record<string, unknown> => value != null && typeof value === "object" && value.kind === "source_quality");
  const value = entries.at(-1);
  if (!value || value.version !== 1 || !timestamp(value.calculated_at)
    || (value.source_as_of !== null && !timestamp(value.source_as_of))
    || (value.received_at !== null && !timestamp(value.received_at))
    || typeof value.query_complete !== "boolean" || value.period_coverage !== "unconfirmed"
    || (value.expected_facility_ids !== null && !ids(value.expected_facility_ids))
    || !ids(value.contributing_facility_ids)
    || typeof value.basis !== "string" || !["haven_live_v1", "haven_live_v2", "manual", "mixed", "unknown"].includes(value.basis)) return null;
  if (value.expected_facility_ids !== null && !value.contributing_facility_ids.every((id) => (value.expected_facility_ids as string[]).includes(id))) return null;
  return value as unknown as StandupSourceQuality;
}

export type StandupMetricDefinitionSnapshot = {
  kind: "metric_definition"; version: 1; key: string; label: string; description: string;
  value_type: "currency" | "count" | "percent" | "hours" | "text";
  source_mode: "auto" | "manual" | "hybrid" | "forecast";
  section_key: "ar_census" | "bed_availability" | "admissions" | "risk_management" | "staffing" | "marketing";
  calculation_basis: "haven_live_v1" | "haven_live_v2";
};

export function readStandupMetricDefinition(metric: QualityMetric | null | undefined): StandupMetricDefinitionSnapshot | null {
  if (!Array.isArray(metric?.sourceRefJson)) return null;
  const saved = metric.sourceRefJson.filter((ref): ref is Record<string, unknown> => ref != null && typeof ref === "object" && ref.kind === "metric_definition").at(-1);
  if (!saved || saved.version !== 1 || saved.key !== metric.key || typeof saved.key !== "string" || !saved.key.trim()
    || typeof saved.label !== "string" || !saved.label.trim() || typeof saved.description !== "string" || !saved.description.trim()
    || typeof saved.value_type !== "string" || !["currency", "count", "percent", "hours", "text"].includes(saved.value_type)
    || typeof saved.source_mode !== "string" || !["auto", "manual", "hybrid", "forecast"].includes(saved.source_mode)
    || typeof saved.section_key !== "string" || !["ar_census", "bed_availability", "admissions", "risk_management", "staffing", "marketing"].includes(saved.section_key)
    || typeof saved.calculation_basis !== "string" || !["haven_live_v1", "haven_live_v2"].includes(saved.calculation_basis)) return null;
  const quality = readStandupSourceQuality(metric);
  if (quality && ["haven_live_v1", "haven_live_v2"].includes(quality.basis) && quality.basis !== saved.calculation_basis) return null;
  return saved as unknown as StandupMetricDefinitionSnapshot;
}

function hasComparableDefinition(metric: QualityMetric, quality: StandupSourceQuality): boolean {
  const hasCapturedDefinition = Array.isArray(metric.sourceRefJson) && metric.sourceRefJson.some((ref) => ref != null && typeof ref === "object" && ref.kind === "metric_definition");
  if (!hasCapturedDefinition) return quality.basis === "haven_live_v1";
  const definition = readStandupMetricDefinition(metric);
  return definition != null && definition.value_type === metric.valueType && definition.calculation_basis === quality.basis;
}

export function standupCoverageLabel(metric: QualityMetric | null | undefined): string {
  const quality = readStandupSourceQuality(metric);
  const expected = quality?.expected_facility_ids;
  if (expected && expected.length > quality.contributing_facility_ids.length) {
    return `Partial: ${quality.contributing_facility_ids.length} of ${expected.length} facilities`;
  }
  return "Coverage unconfirmed";
}

export function qualifyStandupValue(metric: QualityMetric | null | undefined, base: string): string {
  if (typeof metric?.valueText === "string" && metric.valueText.trim()) return metric.valueText;
  if (metric?.valueNumeric == null) return base;
  let qualified = metric.valueNumeric === 0 ? `${base} recorded` : base;
  const quality = readStandupSourceQuality(metric);
  if (quality?.expected_facility_ids && quality.expected_facility_ids.length > quality.contributing_facility_ids.length) {
    qualified += ` — partial ${quality.contributing_facility_ids.length}/${quality.expected_facility_ids.length}`;
  }
  return qualified;
}

export function canCompareStandupMetrics(left: QualityMetric | null | undefined, right: QualityMetric | null | undefined): boolean {
  const a = readStandupSourceQuality(left);
  const b = readStandupSourceQuality(right);
  if (typeof left?.key !== "string" || !left.key.trim() || left.key !== right?.key
    || typeof left.valueType !== "string" || !left.valueType.trim() || left.valueType !== right?.valueType
    || left?.valueNumeric == null || right?.valueNumeric == null || !Number.isFinite(left.valueNumeric) || !Number.isFinite(right.valueNumeric)
    || (typeof left.valueText === "string" && left.valueText.trim().length > 0)
    || (typeof right.valueText === "string" && right.valueText.trim().length > 0) || !a || !b || !["haven_live_v1", "haven_live_v2"].includes(a.basis) || a.basis !== b.basis
    || !a.query_complete || !b.query_complete || !a.expected_facility_ids?.length || !b.expected_facility_ids?.length
    || a.expected_facility_ids.length !== a.contributing_facility_ids.length || b.expected_facility_ids.length !== b.contributing_facility_ids.length) return false;
  return hasComparableDefinition(left, a) && hasComparableDefinition(right, b)
    && a.expected_facility_ids.length === b.expected_facility_ids.length && a.expected_facility_ids.every((id) => b.expected_facility_ids!.includes(id));
}
