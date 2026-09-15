import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

export type FacilityAccessGrantInput = {
  user_id: string;
  facility_id: string;
  organization_id: string;
  is_primary: boolean;
  granted_by: string;
};

/**
 * Idempotent facility grants for user create: reactivate revoked rows, update active
 * duplicates, or insert new grants without tripping idx_ufa_unique.
 */
export async function ensureUserFacilityAccessGrants(
  admin: AdminClient,
  grants: FacilityAccessGrantInput[],
): Promise<{ error: string | null }> {
  for (const grant of grants) {
    const { data: rows, error: lookupErr } = await admin
      .from("user_facility_access")
      .select("id, revoked_at, is_primary")
      .eq("user_id", grant.user_id)
      .eq("facility_id", grant.facility_id)
      .order("granted_at", { ascending: false })
      .limit(5);

    if (lookupErr) {
      return { error: lookupErr.message };
    }

    const active = (rows ?? []).find((row) => row.revoked_at === null);
    if (active) {
      const { error: updateErr } = await admin
        .from("user_facility_access")
        .update({
          is_primary: grant.is_primary,
          granted_by: grant.granted_by,
          organization_id: grant.organization_id,
        })
        .eq("id", active.id);
      if (updateErr) {
        return { error: updateErr.message };
      }
      continue;
    }

    const revoked = (rows ?? []).find((row) => row.revoked_at !== null);
    if (revoked) {
      const { error: reactivateErr } = await admin
        .from("user_facility_access")
        .update({
          revoked_at: null,
          revoked_by: null,
          is_primary: grant.is_primary,
          granted_by: grant.granted_by,
          organization_id: grant.organization_id,
          granted_at: new Date().toISOString(),
        })
        .eq("id", revoked.id);
      if (reactivateErr) {
        return { error: reactivateErr.message };
      }
      continue;
    }

    const { error: insertErr } = await admin.from("user_facility_access").insert({
      user_id: grant.user_id,
      facility_id: grant.facility_id,
      organization_id: grant.organization_id,
      is_primary: grant.is_primary,
      granted_by: grant.granted_by,
    });
    if (insertErr) {
      return { error: insertErr.message };
    }
  }

  return { error: null };
}
