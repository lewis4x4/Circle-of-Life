/**
 * Reads for the resident Timeline tab. The view is security_invoker, so the
 * caller's RLS on every source table applies; this file adds nothing on top.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { TIMELINE_PAGE_SIZE, TIMELINE_SAFETY_CHECK_SOURCE, type ResidentTimelineRow } from "./timeline";

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

/**
 * Newest entries first, capped so the tab stays quick on long stays. Routine safety checks
 * (four or more a day) are read under their own cap, so they never push an incident, a
 * condition change or a note out of the tab.
 */
export async function loadResidentTimeline(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<ResidentTimelineRow[]> {
  const [entries, checks] = await Promise.all([
    supabase
      .from("v_resident_timeline")
      .select("*")
      .eq("resident_id", residentId)
      .neq("source", TIMELINE_SAFETY_CHECK_SOURCE)
      .order("occurred_at", { ascending: false })
      .limit(TIMELINE_PAGE_SIZE),
    supabase
      .from("v_resident_timeline")
      .select("*")
      .eq("resident_id", residentId)
      .eq("source", TIMELINE_SAFETY_CHECK_SOURCE)
      .order("occurred_at", { ascending: false })
      .limit(TIMELINE_PAGE_SIZE),
  ]);
  if (entries.error) throw entries.error;
  if (checks.error) throw checks.error;
  return [...(entries.data ?? []), ...(checks.data ?? [])].sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));
}
