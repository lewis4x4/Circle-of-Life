import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type ResidentRosterMetrics = {
  licensedBeds: number | null;
  occupiedResidents: number;
  openBeds: number | null;
  carePlanReviewsDueWeek: number | null;
};

function startOfTodayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const [y, mo, da] = isoDate.split("-").map((x) => Number(x));
  const d = new Date(Date.UTC(y, mo - 1, da));
  d.setUTCDate(d.getUTCDate() + days);
  const ym = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${ym}-${dd}`;
}

/**
 * Aggregate census + capacity + care-plan review signal for resident roster KPI strip.
 * No schema mutations — reads `facilities`, `care_plans`, and derives occupancy from callers' census count.
 */
export async function fetchResidentRosterMetrics(
  selectedFacilityId: string | null,
  occupiedResidents: number,
  supabase: SupabaseClient<Database>,
): Promise<ResidentRosterMetrics> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) {
    return {
      licensedBeds: null,
      occupiedResidents,
      openBeds: null,
      carePlanReviewsDueWeek: null,
    };
  }

  let licensedBeds: number | null = null;

  try {
    const fac = await supabase
      .from("facilities" as never)
      .select("total_licensed_beds")
      .eq("id", selectedFacilityId)
      .maybeSingle();

    const payload = fac.data as { total_licensed_beds: number | null } | null;
    const n = payload?.total_licensed_beds;
    licensedBeds = typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    licensedBeds = null;
  }

  const openBeds =
    licensedBeds != null ? Math.max(0, licensedBeds - occupiedResidents) : null;

  let carePlanReviewsDueWeek: number | null = null;
  const today = startOfTodayIsoDate();
  const horizon = addDaysIsoDate(today, 7);

  try {
    const plans = await supabase
      .from("care_plans" as never)
      .select("resident_id")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["active", "under_review"])
      .gte("review_due_date", today)
      .lte("review_due_date", horizon);

    if (plans.error) {
      carePlanReviewsDueWeek = null;
    } else {
      const rowsPlans = plans.data as { resident_id: string }[] | null;
      const ids = new Set((rowsPlans ?? []).map((r) => r.resident_id));
      carePlanReviewsDueWeek = ids.size;
    }
  } catch {
    carePlanReviewsDueWeek = null;
  }

  return {
    licensedBeds,
    occupiedResidents,
    openBeds,
    carePlanReviewsDueWeek,
  };
}
