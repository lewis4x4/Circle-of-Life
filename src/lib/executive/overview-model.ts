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
      const { occ_pt: _occ, ...rest } = facility.metrics;
      return { ...facility, metrics: rest };
    }

    const occPt = facilityOccPtMetricValue(licensed, census);
    if (occPt === undefined) return facility;
    return {
      ...facility,
      metrics: { ...facility.metrics, occ_pt: occPt },
    };
  });
}
