import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type ExecutiveAlertRow = Database["public"]["Tables"]["exec_alerts"]["Row"];

export async function fetchExecutiveAlerts(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
  limit = 50,
): Promise<ExecutiveAlertRow[]> {
  let q = supabase
    .from("exec_alerts")
    .select("*")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("resolved_at", null)
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (isValidFacilityIdForQuery(facilityId)) {
    q = q.or(`facility_id.eq.${facilityId},facility_id.is.null`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function acknowledgeExecutiveAlert(
  supabase: SupabaseClient<Database>,
  alertId: string,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("exec_alerts")
    .update({
      acknowledged_at: now,
      acknowledged_by: userId,
      updated_at: now,
    })
    .eq("id", alertId);

  if (error) throw new Error(error.message);
}
