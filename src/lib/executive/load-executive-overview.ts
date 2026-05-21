import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachFacilityMetrics,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
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
import type { Database } from "@/types/database";

export type ExecutiveOverviewData = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: ExecutiveOverviewFacility[];
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
};

type MetricSnapshotRow = {
  facility_id: string | null;
  metric_code: string;
  metric_value_numeric: number | null;
};

export async function loadExecutiveOverview(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ExecutiveOverviewData> {
  // Use allSettled so one failing query (e.g., a snapshot table that's empty
  // or an assurance lookup that errors) doesn't blank the entire dashboard.
  const [aggregateSnapshotsRes, facilitySnapshotsRes, alertsRes, facilitiesRes, assuranceRows, assuranceTrendRows] =
    await Promise.allSettled([
      buildAggregateSnapshotQuery(supabase, organizationId),
      buildFacilitySnapshotQuery(supabase, organizationId),
      supabase
        .from("exec_alerts")
        .select("*, facilities(name)")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .is("deleted_at", null)
        .order("severity", { ascending: false })
        .limit(5),
      supabase
        .from("facilities")
        .select("id, name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      fetchResidentAssuranceFacilityHeatMap(supabase, organizationId),
      fetchResidentAssuranceFacilityTrendSeries(supabase, organizationId, 7),
    ]);

  const aggregateRows = aggregateSnapshotsRes.status === "fulfilled" ? aggregateSnapshotsRes.value.data ?? [] : [];
  const facilitySnapshotRows = facilitySnapshotsRes.status === "fulfilled" ? facilitySnapshotsRes.value.data ?? [] : [];
  const alertRows = alertsRes.status === "fulfilled" ? alertsRes.value.data ?? [] : [];
  const facilityRows = facilitiesRes.status === "fulfilled" ? facilitiesRes.value.data ?? [] : [];
  const heatMap = assuranceRows.status === "fulfilled" ? assuranceRows.value : [];
  const trends = assuranceTrendRows.status === "fulfilled" ? assuranceTrendRows.value : [];

  return {
    metrics: buildLatestMetricMap(aggregateRows as MetricSnapshotRow[]),
    alerts: alertRows as AlertWithFacility[],
    facilities: attachFacilityMetrics(facilityRows, facilitySnapshotRows as MetricSnapshotRow[]),
    assuranceHeatMap: heatMap,
    assuranceTrends: trends,
  };
}
