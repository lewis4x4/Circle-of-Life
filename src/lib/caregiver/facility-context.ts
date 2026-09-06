import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type CaregiverFacilityContext = { facilityId: string; organizationId: string; facilityName: string | null; timeZone: string };
type CaregiverFacilityContextInput = { userId: string; organizationId?: string | null; appRole?: string | null; selectedFacilityId?: string | null };
export const workingFacilityKey = (userId: string) => `haven:working-facility:${userId}`;

/** Every option is re-authorized from current database grants. Storage is only a preference. */
export async function loadCaregiverFacilityOptions(supabase: SupabaseClient<Database>, userId: string): Promise<CaregiverFacilityContext[]> {
  const profile = await supabase.from("user_profiles").select("organization_id, app_role").eq("id", userId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data?.organization_id) throw new Error("Your staff profile is unavailable.");
  let facilityQuery = supabase.from("facilities").select("id, name, organization_id, timezone").eq("organization_id", profile.data.organization_id).is("deleted_at", null).order("name");
  if (!["owner", "org_admin"].includes(profile.data.app_role)) {
    const access = await supabase.from("user_facility_access").select("facility_id").eq("user_id", userId).is("revoked_at", null);
    if (access.error) throw access.error;
    const ids = (access.data ?? []).map((row) => row.facility_id);
    if (!ids.length) return [];
    facilityQuery = facilityQuery.in("id", ids);
  }
  const facilities = await facilityQuery;
  if (facilities.error) throw facilities.error;
  return (facilities.data ?? []).map((row) => ({ facilityId: row.id, organizationId: row.organization_id, facilityName: row.name, timeZone: row.timezone?.trim() || "America/New_York" }));
}

export function selectWorkingFacility(options: CaregiverFacilityContext[], preferred: string | null): CaregiverFacilityContext | null {
  if (preferred) return options.find((option) => option.facilityId === preferred) ?? null;
  return options.length === 1 ? options[0] : null;
}

export async function loadCaregiverFacilityContextForUser(supabase: SupabaseClient<Database>, { userId, selectedFacilityId }: CaregiverFacilityContextInput): Promise<{ ok: true; ctx: CaregiverFacilityContext } | { ok: false; error: string }> {
  try {
    const options = await loadCaregiverFacilityOptions(supabase, userId);
    const preferred = selectedFacilityId ?? (typeof window !== "undefined" ? sessionStorage.getItem(workingFacilityKey(userId)) : null);
    const ctx = selectWorkingFacility(options, preferred);
    if (!ctx) return { ok: false, error: options.length ? "Choose your working facility in the shift header before continuing." : "No active facility access is assigned to your account." };
    return { ok: true, ctx };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Working facility is unavailable." }; }
}

export async function loadCaregiverFacilityContext(supabase: SupabaseClient<Database>): Promise<{ ok: true; ctx: CaregiverFacilityContext } | { ok: false; error: string }> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, error: error?.message ?? "You need to sign in." };
  return loadCaregiverFacilityContextForUser(supabase, { userId: user.id });
}
