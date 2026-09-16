/**
 * Reads for the resident Timeline tab. The view is security_invoker, so the
 * caller's RLS on every source table applies; this file adds nothing on top.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { TIMELINE_PAGE_SIZE, type ResidentTimelineRow } from "./timeline";

export const DEFAULT_TIMELINE_TIME_ZONE = "America/New_York";

/** The resident's facility zone so days group the way the building experiences them. */
export async function loadResidentTimeZone(supabase: SupabaseClient<Database>, residentId: string): Promise<string> {
  const resident = await supabase.from("residents").select("facility_id").eq("id", residentId).maybeSingle();
  if (resident.error) throw resident.error;
  if (!resident.data?.facility_id) return DEFAULT_TIMELINE_TIME_ZONE;
  const facility = await supabase.from("facilities").select("timezone").eq("id", resident.data.facility_id).maybeSingle();
  if (facility.error) throw facility.error;
  return facility.data?.timezone?.trim() || DEFAULT_TIMELINE_TIME_ZONE;
}

/** Newest entries first, capped so the tab stays quick on long stays. */
export async function loadResidentTimeline(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<ResidentTimelineRow[]> {
  const result = await supabase
    .from("v_resident_timeline")
    .select("*")
    .eq("resident_id", residentId)
    .order("occurred_at", { ascending: false })
    .limit(TIMELINE_PAGE_SIZE);
  if (result.error) throw result.error;
  return result.data ?? [];
}
