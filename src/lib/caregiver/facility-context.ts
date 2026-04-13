import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type CaregiverFacilityContext = {
  facilityId: string;
  organizationId: string;
  facilityName: string | null;
  /** IANA timezone for scheduling (e.g. America/New_York) */
  timeZone: string;
};

type ProfileRow = { organization_id: string; app_role: string };

/**
 * Resolves the signed-in caregiver's primary facility and org for floor workflows (eMAR, clock, schedules).
 * Mirrors incident-draft facility resolution.
 */
export async function loadCaregiverFacilityContext(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; ctx: CaregiverFacilityContext } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) return { ok: false, error: userError.message };
  if (!user) return { ok: false, error: "You need to sign in." };

  const profileResult = await supabase
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileResult.error) {
    const errObj = profileResult.error as unknown as Record<string, unknown>;
    const pgCode = errObj.code ?? "";
    const hint = errObj.hint ?? "";
    const detail = errObj.details ?? "";
    console.error("[Haven] user_profiles query failed", { message: profileResult.error.message, pgCode, hint, detail, userId: user.id });
    return { ok: false, error: `${profileResult.error.message}${pgCode ? ` (${pgCode})` : ""}` };
  }
  const profile = profileResult.data as ProfileRow | null;
  if (!profile?.organization_id) {
    return { ok: false, error: "Your profile is missing an organization. Contact an administrator." };
  }

  let resolvedFacilityId: string | null = null;
  let resolvedOrgId = profile.organization_id;
  let resolvedFacilityName: string | null = null;
  let timeZone = "America/New_York";

  if (profile.app_role === "owner" || profile.app_role === "org_admin") {
    const facResult = await supabase
      .from("facilities")
      .select("id, name, organization_id, timezone")
      .eq("organization_id", profile.organization_id)
      .is("deleted_at", null)
      .order("name")
      .limit(1)
      .maybeSingle();
    if (facResult.error) return { ok: false, error: facResult.error.message };
    const row = facResult.data;
    if (row) {
      resolvedFacilityId = row.id;
      resolvedOrgId = row.organization_id;
      resolvedFacilityName = row.name;
      if (row.timezone?.trim()) timeZone = row.timezone.trim();
    }
  } else {
    const accessResult = await supabase
      .from("user_facility_access")
      .select("facility_id")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (accessResult.error) return { ok: false, error: accessResult.error.message };
    const access = accessResult.data as { facility_id: string } | null;
    if (access?.facility_id) resolvedFacilityId = access.facility_id;
    if (resolvedFacilityId) {
      const facResult = await supabase
        .from("facilities")
        .select("id, name, organization_id, timezone")
        .eq("id", resolvedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facResult.error) return { ok: false, error: facResult.error.message };
      const row = facResult.data;
      if (row) {
        resolvedOrgId = row.organization_id;
        resolvedFacilityName = row.name;
        if (row.timezone?.trim()) timeZone = row.timezone.trim();
      }
    }
  }

  if (!resolvedFacilityId) {
    return {
      ok: false,
      error: "No facility access is assigned to your account. Ask an administrator to grant facility access.",
    };
  }

  return {
    ok: true,
    ctx: {
      facilityId: resolvedFacilityId,
      organizationId: resolvedOrgId,
      facilityName: resolvedFacilityName,
      timeZone,
    },
  };
}
