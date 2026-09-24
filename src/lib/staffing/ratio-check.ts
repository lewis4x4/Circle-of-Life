import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/**
 * The staffing-ratio check is on for a facility only when a ratio rule set is assigned
 * to it (facilities.facility_ratio_rule_set_id, Facility > Staffing tab).
 *
 * Brian, 2026-09-23 (COL-675): leave the check off — salaried staff do not clock in and
 * Med-Techs carry the floor. No facility has a rule set, so the check is off everywhere:
 * the staffing console shows no pass or fail and risk-nightly-scorer does not score
 * staffing-adequacy non-compliance. Assigning a rule set turns both back on; nothing in
 * code decides it. `supabase/functions/risk-nightly-scorer` applies the same rule.
 */
export function isStaffingRatioCheckOn(ratioRuleSetId: string | null | undefined): boolean {
  return typeof ratioRuleSetId === "string" && ratioRuleSetId.length > 0;
}

export const STAFFING_RATIO_CHECK_OFF_COPY =
  "Staffing ratio check is off. Ratios are recorded for reference, never scored.";

/** Off for "All facilities" and on any read failure: a missing switch never produces a pass or fail. */
export async function fetchStaffingRatioCheckOn(
  facilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<boolean> {
  if (!facilityId || !isValidFacilityIdForQuery(facilityId)) return false;
  const { data, error } = await supabase
    .from("facilities")
    .select("facility_ratio_rule_set_id")
    .eq("id", facilityId)
    .maybeSingle();
  if (error || !data) return false;
  return isStaffingRatioCheckOn((data as { facility_ratio_rule_set_id: string | null }).facility_ratio_rule_set_id);
}
