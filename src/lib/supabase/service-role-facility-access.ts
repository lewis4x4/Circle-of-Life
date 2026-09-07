import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Mirrors haven.has_facility_access for service-role callers (no auth.uid() in Postgres).
 * owner/org_admin: any facility in their organization; others: user_facility_access row.
 */
export async function serviceRoleUserHasFacilityAccess(
  admin: SupabaseClient<Database>,
  args: { userId: string; facilityId: string; organizationId: string; appRole?: string | null },
): Promise<boolean> {
  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role")
    .eq("id", args.userId)
    .eq("organization_id", args.organizationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!profile?.app_role) return false;

  const { data: facility } = await admin
    .from("facilities")
    .select("id")
    .eq("id", args.facilityId)
    .eq("organization_id", args.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) return false;

  const role = profile.app_role;
  if (role === "owner" || role === "org_admin") {
    return true;
  }
  const { data } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", args.userId)
    .eq("facility_id", args.facilityId)
    .eq("organization_id", args.organizationId)
    .is("revoked_at", null)
    .maybeSingle();
  return !!data;
}
