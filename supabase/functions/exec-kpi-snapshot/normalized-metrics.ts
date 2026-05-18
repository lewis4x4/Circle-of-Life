import type { ExecDashboardMetric } from "../_shared/exec-kpi-metrics.ts";

export type NormalizedMetricRow = {
  organization_id: string;
  metric_code: ExecDashboardMetric["code"];
  entity_id: string | null;
  facility_id: string | null;
  snapshot_date: string;
  period_type: "daily";
  metric_value_numeric: number;
  status_color: ExecDashboardMetric["statusColor"];
  source_version: number;
};

export function normalizedRowsForScope(input: {
  organizationId: string;
  snapshotDate: string;
  sourceVersion: number;
  entityId: string | null;
  facilityId: string | null;
  metrics: ExecDashboardMetric[];
}): NormalizedMetricRow[] {
  return input.metrics.map((metric) => ({
    organization_id: input.organizationId,
    metric_code: metric.code,
    entity_id: input.entityId,
    facility_id: input.facilityId,
    snapshot_date: input.snapshotDate,
    period_type: "daily",
    metric_value_numeric: metric.value,
    status_color: metric.statusColor,
    source_version: input.sourceVersion,
  }));
}
