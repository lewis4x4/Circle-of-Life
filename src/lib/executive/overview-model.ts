import type { ExecutiveAlertRow } from "@/lib/exec-alerts";
import {
  facilityOccPtMetricValue,
  isFacilityOccupancyCensusLoaded,
  type FacilityBedCensus,
} from "@/lib/executive/facility-occupancy-census";

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
  snapshot_date?: string | null;
};

/** A recorded figure and the day it was recorded. Neither is useful alone. */
export type LatestMetric = {
  value: number;
  /** Operating day this value was recorded, when the row carried one. */
  snapshotDate: string | null;
};

/**
 * Latest recorded value per metric, each with its own recorded day.
 *
 * Rows arrive newest-first, and a run only writes a metric it could compute,
 * so the newest row for one metric can be days older than the newest row for
 * another. Carrying the date with the value is what keeps the page from
 * presenting last week's readiness review under today's run date.
 *
 * A row with no numeric value is a metric that was never computed — it stays
 * absent rather than becoming a zero the page would display as a result.
 */
export function buildLatestMetricEntries(rows: MetricSnapshotRow[]): Record<string, LatestMetric> {
  const metrics: Record<string, LatestMetric> = {};

  for (const row of rows) {
    if (row.metric_value_numeric == null) continue;
    if (metrics[row.metric_code] === undefined) {
      metrics[row.metric_code] = {
        value: row.metric_value_numeric,
        snapshotDate: row.snapshot_date ?? null,
      };
    }
  }

  return metrics;
}

/** The values alone, for the callers that display a figure without dating it. */
export function buildLatestMetricMap(rows: MetricSnapshotRow[]): Record<string, number> {
  const entries = buildLatestMetricEntries(rows);
  const metrics: Record<string, number> = {};
  for (const [code, entry] of Object.entries(entries)) metrics[code] = entry.value;
  return metrics;
}

/** The recorded day per metric, for the callers that must age each one. */
export function buildLatestMetricDates(rows: MetricSnapshotRow[]): Record<string, string> {
  const dates: Record<string, string> = {};
  for (const [code, entry] of Object.entries(buildLatestMetricEntries(rows))) {
    if (entry.snapshotDate) dates[code] = entry.snapshotDate;
  }
  return dates;
}

export function attachFacilityMetrics(
  facilities: Array<{ id: string; name: string }>,
  rows: MetricSnapshotRow[],
): ExecutiveOverviewFacility[] {
  const byFacility = new Map<string, Record<string, number>>();

  for (const row of rows) {
    if (!row.facility_id) continue;
    if (row.metric_value_numeric == null) continue;
    const metricMap = byFacility.get(row.facility_id) ?? {};
    if (metricMap[row.metric_code] === undefined) {
      metricMap[row.metric_code] = row.metric_value_numeric;
      byFacility.set(row.facility_id, metricMap);
    }
  }

  return facilities.map((facility) => ({
    ...facility,
    metrics: byFacility.get(facility.id) ?? {},
  }));
}

/**
 * Align per-facility `occ_pt` with bed-census loaded state — strip snapshot zeros that
 * read as empty buildings and refresh loaded rows from the live bed grid.
 */
export function applyFacilityOccupancyMetricHonesty(
  facilities: ExecutiveOverviewFacility[],
  bedCensusByFacility: Map<string, FacilityBedCensus>,
  licensedFacilities: Array<{ id: string; total_licensed_beds?: number | null }>,
): ExecutiveOverviewFacility[] {
  const licensedById = new Map(licensedFacilities.map((facility) => [facility.id, facility]));

  return facilities.map((facility) => {
    const licensed = licensedById.get(facility.id);
    if (!licensed) return facility;

    const census = bedCensusByFacility.get(facility.id);
    const loaded = isFacilityOccupancyCensusLoaded(licensed, census);

    if (!loaded) {
      if (facility.metrics.occ_pt === undefined) return facility;
      const metrics = { ...facility.metrics };
      delete metrics.occ_pt;
      return { ...facility, metrics };
    }

    const occPt = facilityOccPtMetricValue(licensed, census);
    if (occPt === undefined) return facility;
    return {
      ...facility,
      metrics: { ...facility.metrics, occ_pt: occPt },
    };
  });
}
