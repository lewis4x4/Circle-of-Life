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
  fetchCensusDailyLog,
  summarizeResidentDayWindow,
  type ResidentDayWindow,
} from "@/lib/executive/resident-days";
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
  /**
   * Resident-days recorded for the incident-rate window, and how many of the
   * window's days were recorded at all. Null when the census could not be read
   * or no facility is in scope — which is not the same as a window of zeros.
   */
  residentDayWindow: ResidentDayWindow | null;
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
  // The bed census and the resident-day window depend on this same facility
  // list; do not fetch it three times.
  const facilityQuery = withTimeout(
    supabase.from("facilities").select("id, name, total_licensed_beds")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("name", { ascending: true }),
    "facilities",
  );

  // The run record behind the tiles: when it executed and what denominators it
  // used. Its absence is reported, never silently read as "current". The
  // resident-day window is anchored on the day this run covers, so it is named
  // here rather than inline below.
  const snapshotRunQuery = withTimeout(
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
    residentDayWindowRes,
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
      snapshotRunQuery,
      // Resident-days actually recorded across the incident-rate window. The
      // window ends on the day the run covers, so the numerator and denominator
      // describe the same period even when the run is a day or two behind.
      withTimeout(
        (async () => {
          const [{ data: facilityRows, error }, snapshotRun] = await Promise.all([
            facilityQuery,
            snapshotRunQuery,
          ]);
          if (error) return null;
          const facilityIds = (facilityRows ?? []).map((facility) => facility.id);
          if (facilityIds.length === 0) return null;
          const runDate = snapshotRun.error
            ? null
            : (snapshotRun.data?.[0] as { snapshot_date?: string } | undefined)?.snapshot_date ?? null;
          const endIsoDate = runDate ?? facilityTodayIsoDate();
          const rows = await fetchCensusDailyLog(supabase, organizationId, { endIsoDate });
          return summarizeResidentDayWindow({ rows, facilityIds, endIsoDate });
        })(),
        "resident-day-window",
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
  // A failed read leaves the window unknown, which the basis reports as a
  // projection rather than as a window nobody recorded.
  const residentDayWindow =
    residentDayWindowRes.status === "fulfilled" ? residentDayWindowRes.value : null;

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
    residentDayWindow,
    metricChanges: buildPortfolioMetricChanges(aggregateRows as MetricSnapshotRow[]),
    metricDates: buildLatestMetricDates(aggregateRows as MetricSnapshotRow[]),
    todayIsoDate,
  };
}
