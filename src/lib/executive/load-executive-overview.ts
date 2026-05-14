import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachFacilityMetrics,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
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
  const [aggregateSnapshotsRes, facilitySnapshotsRes, alertsRes, facilitiesRes, assuranceRows, assuranceTrendRows] =
    await Promise.all([
      supabase
        .from("exec_metric_snapshots")
        .select("facility_id, metric_code, metric_value_numeric")
        .eq("organization_id", organizationId)
        .is("facility_id", null)
        .is("deleted_at", null)
        .order("snapshot_date", { ascending: false })
        .limit(50),
      supabase
        .from("exec_metric_snapshots")
        .select("facility_id, metric_code, metric_value_numeric")
        .eq("organization_id", organizationId)
        .not("facility_id", "is", null)
        .is("deleted_at", null)
        .order("snapshot_date", { ascending: false })
        .limit(500),
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

  return {
    metrics: buildLatestMetricMap((aggregateSnapshotsRes.data ?? []) as MetricSnapshotRow[]),
    alerts: (alertsRes.data ?? []) as AlertWithFacility[],
    facilities: attachFacilityMetrics(facilitiesRes.data ?? [], (facilitySnapshotsRes.data ?? []) as MetricSnapshotRow[]),
    assuranceHeatMap: assuranceRows,
    assuranceTrends: assuranceTrendRows,
  };
}
