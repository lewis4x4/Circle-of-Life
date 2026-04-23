import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExecutiveAlertRow } from "@/lib/exec-alerts";
import {
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
  type ResidentAssuranceFacilityRollup,
  type ResidentAssuranceFacilityTrendRow,
} from "@/lib/resident-assurance/command-center-brief";
import type { Database } from "@/types/database";

export interface AlertWithFacility extends ExecutiveAlertRow {
  facilities?: { name: string } | null;
}

export type ExecutiveOverviewData = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: Array<{ id: string; name: string }>;
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
};

export async function loadExecutiveOverview(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ExecutiveOverviewData> {
  const [snapshotsRes, alertsRes, facilitiesRes, assuranceRows, assuranceTrendRows] =
    await Promise.all([
      supabase
        .from("exec_metric_snapshots")
        .select("metric_code, metric_value_numeric")
        .order("snapshot_date", { ascending: false })
        .limit(20),
      supabase
        .from("exec_alerts")
        .select("*, facilities(name)")
        .eq("organization_id", organizationId)
        .eq("status", "open")
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

  const metrics: Record<string, number> = {};
  for (const row of snapshotsRes.data ?? []) {
    const code = (row as { metric_code: string }).metric_code;
    const value = (row as { metric_value_numeric: number | null }).metric_value_numeric;
    if (!metrics[code]) {
      metrics[code] = value ?? 0;
    }
  }

  return {
    metrics,
    alerts: (alertsRes.data ?? []) as AlertWithFacility[],
    facilities: facilitiesRes.data ?? [],
    assuranceHeatMap: assuranceRows,
    assuranceTrends: assuranceTrendRows,
  };
}
