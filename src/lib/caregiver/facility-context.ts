import type { SupabaseClient } from "@supabase/supabase-js";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchFacilityShiftDefinitions, type FacilityShiftDefinition } from "@/lib/caregiver/shift";
import type { Database } from "@/types/database";

export type CaregiverFacilityContext = {
  facilityId: string;
  organizationId: string;
  facilityName: string | null;
  timeZone: string;
  /** The facility's configured shifts; `currentShiftFor(ctx)` reads them (COL-659). */
  shifts?: FacilityShiftDefinition[];
};
type CaregiverFacilityContextInput = { userId: string; organizationId?: string | null; appRole?: string | null; selectedFacilityId?: string | null };
export const workingFacilityKey = (userId: string) => `haven:working-facility:${userId}`;

/** Every option is re-authorized from current database grants. Storage is only a preference. */
export async function loadCaregiverFacilityOptions(supabase: SupabaseClient<Database>, userId: string): Promise<CaregiverFacilityContext[]> {
  // The grant read does not depend on the profile, so both run at once (COL-674);
  // owners and org admins simply ignore the grants.
  const [profile, access] = await Promise.all([
    supabase.from("user_profiles").select("organization_id, app_role").eq("id", userId).maybeSingle(),
    supabase.from("user_facility_access").select("facility_id").eq("user_id", userId).is("revoked_at", null),
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data?.organization_id) throw new Error("Your staff profile is unavailable.");
  let facilityQuery = supabase.from("facilities").select("id, name, organization_id, timezone").eq("organization_id", profile.data.organization_id).is("deleted_at", null).order("name");
  if (!["owner", "org_admin"].includes(profile.data.app_role)) {
    if (access.error) throw access.error;
    const ids = (access.data ?? []).map((row) => row.facility_id);
    if (!ids.length) return [];
    facilityQuery = facilityQuery.in("id", ids);
  }
  const facilities = await facilityQuery;
  if (facilities.error) throw facilities.error;
  return (facilities.data ?? []).map((row) => ({ facilityId: row.id, organizationId: row.organization_id, facilityName: row.name, timeZone: row.timezone?.trim() || "America/New_York" }));
}

/**
 * The caregiver shift header stores its choice in session storage; the admin/app shell
 * facility picker stores its choice in the facility store. Either counts as the working
 * facility — both are preferences only, re-authorized by `selectWorkingFacility`.
 */
export function preferredFacilityId(userId: string, selectedFacilityId?: string | null): string | null {
  const explicit = selectedFacilityId?.trim();
  if (explicit) return explicit;
  const shiftHeader = typeof window !== "undefined" ? sessionStorage.getItem(workingFacilityKey(userId)) : null;
  return shiftHeader?.trim() || useFacilityStore.getState().selectedFacilityId;
}

export function selectWorkingFacility(options: CaregiverFacilityContext[], preferred: string | null): CaregiverFacilityContext | null {
  if (preferred) return options.find((option) => option.facilityId === preferred) ?? null;
  return options.length === 1 ? options[0] : null;
}

/** Shift definitions are display/labelling input; a failed read falls back to the legacy buckets rather than blocking the page. */
async function loadShiftsQuietly(supabase: SupabaseClient<Database>, facilityId: string): Promise<FacilityShiftDefinition[]> {
  try {
    return (await fetchFacilityShiftDefinitions(supabase, [facilityId])).get(facilityId) ?? [];
  } catch (error) {
    console.error("[facility-context] shift definitions unavailable", error);
    return [];
  }
}

export async function loadCaregiverFacilityContextForUser(supabase: SupabaseClient<Database>, { userId, selectedFacilityId }: CaregiverFacilityContextInput): Promise<{ ok: true; ctx: CaregiverFacilityContext } | { ok: false; error: string }> {
  try {
    const preferred = preferredFacilityId(userId, selectedFacilityId);
    // The preferred facility's shifts load alongside the grants (COL-674 keeps these reads parallel);
    // they are only used once the grants confirm the facility.
    const preferredShifts = preferred ? loadShiftsQuietly(supabase, preferred) : null;
    const options = await loadCaregiverFacilityOptions(supabase, userId);
    const ctx = selectWorkingFacility(options, preferred);
    if (!ctx) return { ok: false, error: options.length ? "Choose your working facility in the header before continuing." : "No active facility access is assigned to your account." };
    const shifts = preferredShifts && ctx.facilityId === preferred ? await preferredShifts : await loadShiftsQuietly(supabase, ctx.facilityId);
    return { ok: true, ctx: { ...ctx, shifts } };
  } catch (error) {
    // Messages thrown above are written for staff; database errors (they carry a code) are not.
    if (error instanceof Error && !("code" in error)) return { ok: false, error: error.message };
    console.error("[facility-context] working facility lookup failed", error);
    return { ok: false, error: "Your working facility could not be loaded right now. Try again." };
  }
}

export async function loadCaregiverFacilityContext(supabase: SupabaseClient<Database>): Promise<{ ok: true; ctx: CaregiverFacilityContext } | { ok: false; error: string }> {
  // Verified locally against the project's signing keys instead of an Auth
  // server round trip per page (COL-674); every read below is still re-authorized
  // by the database, which refuses a revoked session.
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return { ok: false, error: error?.message ?? "You need to sign in." };
  return loadCaregiverFacilityContextForUser(supabase, { userId });
}
