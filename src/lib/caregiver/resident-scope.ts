import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import type { Database } from "@/types/database";

/** Shown by every caregiver resident page when the resident is outside the working facility. */
export const CAREGIVER_RESIDENT_OUT_OF_SCOPE_COPY = "This resident is not in your current facility scope.";

export type CaregiverResidentScope =
  | { ok: true; facilityId: string }
  | { ok: false; outOfScope: boolean; error: string };

/**
 * A resident in another building is either hidden by RLS (no row) or visible
 * but outside the working facility. Both read as out of scope, the way the
 * ADL, behavior, condition-change and log pages already do (COL-661 A5),
 * rather than as a failed `.single()` coercion.
 */
export async function checkCaregiverResidentScope(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<CaregiverResidentScope> {
  const context = await loadCaregiverFacilityContext(supabase);
  if (!context.ok) return { ok: false, outOfScope: false, error: context.error };

  const { data, error } = await supabase
    .from("residents")
    .select("id, facility_id")
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[resident-scope] resident lookup failed", error);
    return { ok: false, outOfScope: false, error: "This resident could not be loaded right now. Try again." };
  }
  const row = data as { id: string; facility_id: string } | null;
  if (!row || row.facility_id !== context.ctx.facilityId) {
    return { ok: false, outOfScope: true, error: CAREGIVER_RESIDENT_OUT_OF_SCOPE_COPY };
  }
  return { ok: true, facilityId: context.ctx.facilityId };
}
