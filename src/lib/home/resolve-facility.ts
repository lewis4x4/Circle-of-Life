import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * The building Home renders for: the facility chip's cookie when it names one
 * the caller can see, else the caller's primary facility, else the first
 * accessible one. Null when the caller has no facility at all — the page then
 * falls back to the general dashboard, which says so.
 */
export async function resolveOperatorHomeFacility(
  supabase: SupabaseClient<Database>,
  userId: string,
  cookieFacilityId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_facility_access")
    .select("facility_id, is_primary, facilities!inner(id, deleted_at)")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error || !data) return null;
  const rows = data as unknown as Array<{ facility_id: string; is_primary: boolean; facilities: { id: string; deleted_at: string | null } | null }>;
  const live = rows.filter((row) => row.facilities && !row.facilities.deleted_at);
  if (cookieFacilityId && live.some((row) => row.facility_id === cookieFacilityId)) return cookieFacilityId;
  return live.find((row) => row.is_primary)?.facility_id ?? live[0]?.facility_id ?? null;
}
