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
  basis: "haven_live_v1" | "manual" | "mixed" | "unknown";
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
    || typeof value.basis !== "string" || !["haven_live_v1", "manual", "mixed", "unknown"].includes(value.basis)) return null;
  if (value.expected_facility_ids !== null && !value.contributing_facility_ids.every((id) => (value.expected_facility_ids as string[]).includes(id))) return null;
  return value as unknown as StandupSourceQuality;
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
    || (typeof right.valueText === "string" && right.valueText.trim().length > 0) || !a || !b || a.basis !== "haven_live_v1" || b.basis !== "haven_live_v1"
    || !a.query_complete || !b.query_complete || !a.expected_facility_ids?.length || !b.expected_facility_ids?.length
    || a.expected_facility_ids.length !== a.contributing_facility_ids.length || b.expected_facility_ids.length !== b.contributing_facility_ids.length) return false;
  return a.expected_facility_ids.length === b.expected_facility_ids.length && a.expected_facility_ids.every((id) => b.expected_facility_ids!.includes(id));
}
