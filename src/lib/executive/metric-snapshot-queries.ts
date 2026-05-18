import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export function buildAggregateSnapshotQuery(
  supabase: SupabaseClient<Database>,
  organizationId: string,
) {
  return supabase
    .from("exec_metric_snapshots")
    .select("facility_id, metric_code, metric_value_numeric")
    .eq("organization_id", organizationId)
    .is("entity_id", null)
    .is("facility_id", null)
    .is("deleted_at", null)
    .order("snapshot_date", { ascending: false })
    .limit(50);
}

export function buildFacilitySnapshotQuery(
  supabase: SupabaseClient<Database>,
  organizationId: string,
) {
  return supabase
    .from("exec_metric_snapshots")
    .select("facility_id, metric_code, metric_value_numeric")
    .eq("organization_id", organizationId)
    .not("facility_id", "is", null)
    .is("deleted_at", null)
    .order("snapshot_date", { ascending: false })
    .limit(500);
}
