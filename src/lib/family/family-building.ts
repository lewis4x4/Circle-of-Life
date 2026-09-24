import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * The building a family member's loved one lives in, for the portal header
 * (COL-714). When their linked residents live in more than one building, or the
 * read fails, there is no single building to name, so this returns null.
 * Plain reads under the family member's RLS; no embeds.
 */
export async function loadFamilyBuildingName(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const links = await supabase
    .from("family_resident_links")
    .select("resident_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .limit(20);
  const residentIds = [...new Set((links.data ?? []).map((row) => row.resident_id))];
  if (links.error || residentIds.length === 0) return null;

  const residents = await supabase.from("residents").select("facility_id").in("id", residentIds).is("deleted_at", null);
  const facilityIds = [...new Set((residents.data ?? []).map((row) => row.facility_id).filter(Boolean))];
  if (residents.error || facilityIds.length !== 1) return null;

  const facility = await supabase.from("facilities").select("name").eq("id", facilityIds[0]!).maybeSingle();
  if (facility.error) return null;
  return facility.data?.name?.trim() || null;
}
