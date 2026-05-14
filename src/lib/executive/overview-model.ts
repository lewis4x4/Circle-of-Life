import type { ExecutiveAlertRow } from "@/lib/exec-alerts";

export interface AlertWithFacility extends ExecutiveAlertRow {
  facilities?: { name: string } | null;
}

export type ExecutiveOverviewFacility = {
  id: string;
  name: string;
  metrics: Record<string, number>;
};

type MetricSnapshotRow = {
  facility_id: string | null;
  metric_code: string;
  metric_value_numeric: number | null;
};

export function buildLatestMetricMap(rows: MetricSnapshotRow[]): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const row of rows) {
    if (metrics[row.metric_code] === undefined) {
      metrics[row.metric_code] = row.metric_value_numeric ?? 0;
    }
  }

  return metrics;
}

export function attachFacilityMetrics(
  facilities: Array<{ id: string; name: string }>,
  rows: MetricSnapshotRow[],
): ExecutiveOverviewFacility[] {
  const byFacility = new Map<string, Record<string, number>>();

  for (const row of rows) {
    if (!row.facility_id) continue;
    const metricMap = byFacility.get(row.facility_id) ?? {};
    if (metricMap[row.metric_code] === undefined) {
      metricMap[row.metric_code] = row.metric_value_numeric ?? 0;
      byFacility.set(row.facility_id, metricMap);
    }
  }

  return facilities.map((facility) => ({
    ...facility,
    metrics: byFacility.get(facility.id) ?? {},
  }));
}
