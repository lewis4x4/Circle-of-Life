import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachFacilityMetrics,
  applyFacilityOccupancyMetricHonesty,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import { fetchFacilityBedCensusById } from "@/lib/executive/facility-occupancy-census";
import {
  buildAggregateSnapshotQuery,
  buildFacilitySnapshotQuery,
} from "@/lib/executive/metric-snapshot-queries";
import {
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
  type ResidentAssuranceFacilityRollup,
  type ResidentAssuranceFacilityTrendRow,
} from "@/lib/resident-assurance/command-center-brief";
import {
  EMPTY_PRESENCE_CENSUS,
  fetchPresenceCensus,
  type PresenceCensus,
} from "@/lib/executive/presence-census";
import type { OccupancyContext } from "@/lib/executive/kpi-tile-copy";
import type { Database } from "@/types/database";

export type ExecutiveOverviewData = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: ExecutiveOverviewFacility[];
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
  presenceCensus: PresenceCensus;
  occupancyContext: OccupancyContext | null;
};

type MetricSnapshotRow = {
  facility_id: string | null;
  metric_code: string;
  metric_value_numeric: number | null;
};

/** Per-query ceiling so one stuck Supabase call can't gate the whole dashboard. */
const QUERY_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[exec-overview] ${label} exceeded ${QUERY_TIMEOUT_MS}ms`));
    }, QUERY_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function loadExecutiveOverview(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ExecutiveOverviewData> {
  // Use allSettled so one failing query (e.g., a snapshot table that's empty
  // or an assurance lookup that errors) doesn't blank the entire dashboard.
  // Each query is also wrapped in a 5s timeout so the slowest call can't
  // hold up the whole page.
  const [
    aggregateSnapshotsRes,
    facilitySnapshotsRes,
    alertsRes,
    facilitiesRes,
    assuranceRows,
    assuranceTrendRows,
    presenceCensusRes,
    bedCensusRes,
  ] = await Promise.allSettled([
      withTimeout(buildAggregateSnapshotQuery(supabase, organizationId), "aggregate-snapshots"),
      withTimeout(buildFacilitySnapshotQuery(supabase, organizationId), "facility-snapshots"),
      withTimeout(
        supabase
          .from("exec_alerts")
          .select("*, facilities(name)")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .is("deleted_at", null)
          .order("severity", { ascending: false })
          .limit(5),
        "exec-alerts",
      ),
      withTimeout(
        supabase
          .from("facilities")
          .select("id, name, total_licensed_beds")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .order("name", { ascending: true }),
        "facilities",
      ),
      withTimeout(fetchResidentAssuranceFacilityHeatMap(supabase, organizationId), "assurance-heatmap"),
      withTimeout(fetchResidentAssuranceFacilityTrendSeries(supabase, organizationId, 7), "assurance-trends"),
      withTimeout(fetchPresenceCensus(supabase, organizationId), "presence-census"),
      withTimeout(
        (async () => {
          const { data: facilityRows, error } = await supabase
            .from("facilities")
            .select("id")
            .eq("organization_id", organizationId)
            .is("deleted_at", null);
          if (error) throw new Error(error.message);
          const ids = (facilityRows ?? []).map((facility) => facility.id);
          return fetchFacilityBedCensusById(supabase, ids);
        })(),
        "bed-census",
      ),
    ]);

  const aggregateRows = aggregateSnapshotsRes.status === "fulfilled" ? aggregateSnapshotsRes.value.data ?? [] : [];
  const facilitySnapshotRows = facilitySnapshotsRes.status === "fulfilled" ? facilitySnapshotsRes.value.data ?? [] : [];
  const alertRows = alertsRes.status === "fulfilled" ? alertsRes.value.data ?? [] : [];
  const facilityRows = facilitiesRes.status === "fulfilled" ? facilitiesRes.value.data ?? [] : [];
  const heatMap = assuranceRows.status === "fulfilled" ? assuranceRows.value : [];
  const trends = assuranceTrendRows.status === "fulfilled" ? assuranceTrendRows.value : [];
  const presenceCensus = presenceCensusRes.status === "fulfilled" ? presenceCensusRes.value : EMPTY_PRESENCE_CENSUS;
  const bedCensusByFacility =
    bedCensusRes.status === "fulfilled" ? bedCensusRes.value : new Map<string, never>();

  const licensedBeds = facilityRows.reduce(
    (sum, facility) => sum + ((facility as { total_licensed_beds?: number | null }).total_licensed_beds ?? 0),
    0,
  );
  const occupiedResidents = presenceCensus.total;
  const occupancyContext =
    occupiedResidents > 0 && licensedBeds > 0
      ? { occupiedResidents, licensedBeds }
      : null;

  const facilitiesWithMetrics = applyFacilityOccupancyMetricHonesty(
    attachFacilityMetrics(facilityRows, facilitySnapshotRows as MetricSnapshotRow[]),
    bedCensusByFacility,
    facilityRows as Array<{ id: string; total_licensed_beds?: number | null }>,
  );

  return {
    metrics: buildLatestMetricMap(aggregateRows as MetricSnapshotRow[]),
    alerts: alertRows as AlertWithFacility[],
    facilities: facilitiesWithMetrics,
    assuranceHeatMap: heatMap,
    assuranceTrends: trends,
    presenceCensus,
    occupancyContext,
  };
}
