import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachFacilityMetrics,
  applyFacilityOccupancyMetricHonesty,
  buildLatestMetricDates,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import {
  computePortfolioOccupancyFromBedCensus,
  fetchFacilityBedCensusById,
} from "@/lib/executive/facility-occupancy-census";
import {
  buildOccupancyContextFromPortfolioAggregate,
  type OccupancyContext,
} from "@/lib/executive/kpi-tile-copy";
import {
  buildAggregateSnapshotQuery,
  buildFacilitySnapshotQuery,
} from "@/lib/executive/metric-snapshot-queries";
import {
  buildPortfolioMetricChanges,
  type MetricChange,
} from "@/lib/executive/metric-change";
import {
  facilityTodayIsoDate,
  resolveSnapshotState,
  type ExecutiveSnapshotState,
} from "@/lib/executive/snapshot-evidence";
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
import type { Database } from "@/types/database";

export type ExecutiveOverviewData = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: ExecutiveOverviewFacility[];
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
  presenceCensus: PresenceCensus;
  occupancyContext: OccupancyContext | null;
  /** When the portfolio figures were recorded, and the denominators behind them. */
  snapshot: ExecutiveSnapshotState;
  /** Dated portfolio-scope changes, keyed by metric code. Absent = nothing to compare. */
  metricChanges: Record<string, MetricChange>;
  /**
   * Operating day each displayed metric was recorded on. A run writes only the
   * metrics it could compute, so these can differ from each other and from the
   * run's own date.
   */
  metricDates: Record<string, string>;
  /** The facilities' operating day the page ages every recording against. */
  todayIsoDate: string;
};

type MetricSnapshotRow = {
  facility_id: string | null;
  metric_code: string;
  metric_value_numeric: number | null;
  snapshot_date: string;
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
  { strict = false }: { strict?: boolean } = {},
): Promise<ExecutiveOverviewData> {
  // The bed census depends on this same facility list; do not fetch it twice.
  const facilityQuery = withTimeout(
    supabase.from("facilities").select("id, name, total_licensed_beds")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("name", { ascending: true }),
    "facilities",
  );

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
    snapshotRunRes,
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
      facilityQuery,
      withTimeout(fetchResidentAssuranceFacilityHeatMap(supabase, organizationId), "assurance-heatmap"),
      withTimeout(fetchResidentAssuranceFacilityTrendSeries(supabase, organizationId, 7), "assurance-trends"),
      withTimeout(fetchPresenceCensus(supabase, organizationId), "presence-census"),
      withTimeout(
        (async () => {
          const { data: facilityRows, error } = await facilityQuery;
          // Preserve the browser's existing unavailable-facility empty state.
          if (error) return new Map<string, never>();
          const ids = (facilityRows ?? []).map((facility) => facility.id);
          return fetchFacilityBedCensusById(supabase, ids);
        })(),
        "bed-census",
      ),
      // The run record behind the tiles: when it executed and what denominators
      // it used. Its absence is reported, never silently read as "current".
      withTimeout(
        supabase
          .from("exec_kpi_snapshots")
          .select("snapshot_date, computed_at, metrics")
          .eq("organization_id", organizationId)
          .eq("scope_type", "organization")
          .is("deleted_at", null)
          .order("snapshot_date", { ascending: false })
          .order("computed_at", { ascending: false })
          .limit(1),
        "kpi-snapshot-run",
      ),
    ]);

  if (strict) {
    // Match the browser's required-data failure priority. Presence and facility
    // availability remain optional; a required failure keeps the Retry state.
    for (const result of [aggregateSnapshotsRes, facilitySnapshotsRes, alertsRes, bedCensusRes, assuranceRows, assuranceTrendRows]) {
      if (result.status === "rejected") throw result.reason;
      if (result.value && "error" in result.value && result.value.error) {
        throw new Error(result.value.error.message);
      }
    }
  }

  const aggregateRows = aggregateSnapshotsRes.status === "fulfilled" ? aggregateSnapshotsRes.value.data ?? [] : [];
  const facilitySnapshotRows = facilitySnapshotsRes.status === "fulfilled" ? facilitySnapshotsRes.value.data ?? [] : [];
  const alertRows = alertsRes.status === "fulfilled" ? alertsRes.value.data ?? [] : [];
  const facilityRows = facilitiesRes.status === "fulfilled" ? facilitiesRes.value.data ?? [] : [];
  const heatMap = assuranceRows.status === "fulfilled" ? assuranceRows.value : [];
  const trends = assuranceTrendRows.status === "fulfilled" ? assuranceTrendRows.value : [];
  const presenceCensus = presenceCensusRes.status === "fulfilled" ? presenceCensusRes.value : EMPTY_PRESENCE_CENSUS;
  const bedCensusByFacility =
    bedCensusRes.status === "fulfilled" ? bedCensusRes.value : new Map<string, never>();

  const todayIsoDate = facilityTodayIsoDate();
  const snapshotState = resolveSnapshotState({
    row:
      snapshotRunRes.status === "fulfilled" && !snapshotRunRes.value.error
        ? (snapshotRunRes.value.data?.[0] as {
            snapshot_date: string;
            computed_at: string | null;
            metrics: unknown;
          } | undefined) ?? null
        : null,
    errorMessage:
      snapshotRunRes.status === "rejected"
        ? "read failed"
        : snapshotRunRes.value.error?.message ?? null,
    todayIsoDate,
  });

  const licensedBeds = facilityRows.reduce(
    (sum, facility) => sum + ((facility as { total_licensed_beds?: number | null }).total_licensed_beds ?? 0),
    0,
  );
  const portfolioOccupancy =
    facilityRows.length > 0
      ? computePortfolioOccupancyFromBedCensus(
          facilityRows as Array<{ id: string; total_licensed_beds?: number | null }>,
          bedCensusByFacility,
        )
      : null;
  const occupancyContext = portfolioOccupancy
    ? buildOccupancyContextFromPortfolioAggregate(portfolioOccupancy, licensedBeds)
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
    snapshot: snapshotState,
    metricChanges: buildPortfolioMetricChanges(aggregateRows as MetricSnapshotRow[]),
    metricDates: buildLatestMetricDates(aggregateRows as MetricSnapshotRow[]),
    todayIsoDate,
  };
}
