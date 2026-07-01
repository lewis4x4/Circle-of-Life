import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Live resident-presence census for the Command / Executive surface.
 *
 * ADDITIVE to occupancy — it deliberately does NOT redefine it. Held beds
 * (hospital + leave) remain counted as occupied by `occ_pt`,
 * `vw_v2_facility_rollup`, and the standup census; this only breaks that
 * occupied population into in-house vs on-hold so leadership can see who is
 * away without introducing a second, divergent occupancy number.
 *
 * Vocabulary matches src/lib/executive/standup.ts and src/lib/residents/presence.ts:
 *   in-house = active; on-hold = hospital_hold + loa; census = all three.
 */

export type PresenceCensus = {
  /** `active` — present in the facility. */
  inHouse: number;
  /** `hospital_hold` — bed held while hospitalized. */
  hospital: number;
  /** `loa` — bed held while on leave / vacation. */
  onLeave: number;
  /** hospital_hold + loa (held beds). */
  onHold: number;
  /** active + hospital_hold + loa (the billable census population). */
  total: number;
};

export const EMPTY_PRESENCE_CENSUS: PresenceCensus = {
  inHouse: 0,
  hospital: 0,
  onLeave: 0,
  onHold: 0,
  total: 0,
};

/** Pure roll-up of resident status rows into a presence census. */
export function summarizePresenceCensus(
  rows: ReadonlyArray<{ status: string | null }>,
): PresenceCensus {
  let inHouse = 0;
  let hospital = 0;
  let onLeave = 0;
  for (const row of rows) {
    if (row.status === "active") inHouse += 1;
    else if (row.status === "hospital_hold") hospital += 1;
    else if (row.status === "loa") onLeave += 1;
  }
  return {
    inHouse,
    hospital,
    onLeave,
    onHold: hospital + onLeave,
    total: inHouse + hospital + onLeave,
  };
}

/**
 * Fetch the presence census across the org's accessible facilities. RLS scopes
 * rows to facilities the caller can see, so portfolio totals respect access.
 */
export async function fetchPresenceCensus(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<PresenceCensus> {
  const res = (await supabase
    .from("residents")
    .select("status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .limit(5000)) as unknown as {
    data: Array<{ status: string | null }> | null;
    error: { message: string } | null;
  };
  if (res.error) throw new Error(res.error.message);
  return summarizePresenceCensus(res.data ?? []);
}
