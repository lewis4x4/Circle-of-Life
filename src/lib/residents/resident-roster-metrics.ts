import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { queryErrorMessage } from "@/lib/supabase/query-error";
import type { Database } from "@/types/database";

/**
 * What the facility's care plans establish for the residents on the roster.
 * "Zero reviews due" is only meaningful next to how many residents have no
 * active plan at all, so the four figures travel together.
 */
export type CarePlanCoverage = {
  /** Distinct residents with an active / under-review plan whose review is due today through +7 days. */
  reviewsDueWeek: number;
  /** Distinct residents with an active / under-review plan whose review date has passed. */
  reviewsOverdue: number;
  /** Residents on the roster with no active / under-review plan. */
  residentsWithoutActivePlan: number;
  /** Active / under-review plans carrying no review date (schema requires one; counted defensively). */
  plansWithoutReviewDate: number;
};

export type ResidentRosterMetrics = {
  licensedBeds: number | null;
  occupiedResidents: number;
  /** Licensed beds minus census. Arithmetic only — holds and blocked beds are not subtracted. */
  openBeds: number | null;
  /** Kept for the review tile's loaded / not-loaded state; equals `carePlanCoverage.reviewsDueWeek`. */
  carePlanReviewsDueWeek: number | null;
  carePlanCoverage: CarePlanCoverage | null;
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

export type CarePlanCoverageRow = {
  resident_id: string;
  review_due_date: string | null;
};

/**
 * Pure classification of the facility's active / under-review plans against the
 * roster's resident ids. Dates are ISO `YYYY-MM-DD` and compare as strings.
 */
export function classifyCarePlanCoverage(
  plans: CarePlanCoverageRow[],
  rosterResidentIds: string[],
  today: string,
  horizon: string,
): CarePlanCoverage {
  const dueWeek = new Set<string>();
  const overdue = new Set<string>();
  const withPlan = new Set<string>();
  let plansWithoutReviewDate = 0;

  for (const plan of plans) {
    withPlan.add(plan.resident_id);
    const due = plan.review_due_date?.trim() ?? "";
    if (due.length === 0) {
      plansWithoutReviewDate += 1;
      continue;
    }
    if (due < today) overdue.add(plan.resident_id);
    else if (due <= horizon) dueWeek.add(plan.resident_id);
  }

  const residentsWithoutActivePlan = rosterResidentIds.filter((id) => !withPlan.has(id)).length;

  return {
    reviewsDueWeek: dueWeek.size,
    reviewsOverdue: overdue.size,
    residentsWithoutActivePlan,
    plansWithoutReviewDate,
  };
}

/**
 * Aggregate capacity + care-plan coverage for the resident roster summary strip.
 * No schema mutations — reads `facilities` and `care_plans`; census comes from the
 * caller's complete scoped roster.
 */
export async function fetchResidentRosterMetrics(
  selectedFacilityId: string | null,
  rosterResidentIds: string[],
  supabase: SupabaseClient<Database>,
): Promise<ResidentRosterMetrics> {
  const occupiedResidents = rosterResidentIds.length;

  if (!isValidFacilityIdForQuery(selectedFacilityId)) {
    return {
      licensedBeds: null,
      occupiedResidents,
      openBeds: null,
      carePlanReviewsDueWeek: null,
      carePlanCoverage: null,
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
    if (fac.error) {
      console.error("[Haven] licensed beds lookup failed:", queryErrorMessage(fac.error), fac.error);
      licensedBeds = null;
    }
  } catch (error) {
    console.error("[Haven] licensed beds lookup failed:", queryErrorMessage(error), error);
    licensedBeds = null;
  }

  const openBeds =
    licensedBeds != null ? Math.max(0, licensedBeds - occupiedResidents) : null;

  let carePlanCoverage: CarePlanCoverage | null = null;
  const today = startOfTodayIsoDate();
  const horizon = addDaysIsoDate(today, 7);

  try {
    const plans = await supabase
      .from("care_plans" as never)
      .select("resident_id, review_due_date")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["active", "under_review"]);

    if (plans.error) {
      console.error("[Haven] care plan coverage failed:", queryErrorMessage(plans.error), plans.error);
      carePlanCoverage = null;
    } else {
      const rowsPlans = (plans.data as CarePlanCoverageRow[] | null) ?? [];
      carePlanCoverage = classifyCarePlanCoverage(rowsPlans, rosterResidentIds, today, horizon);
    }
  } catch (error) {
    console.error("[Haven] care plan coverage failed:", queryErrorMessage(error), error);
    carePlanCoverage = null;
  }

  return {
    licensedBeds,
    occupiedResidents,
    openBeds,
    carePlanReviewsDueWeek: carePlanCoverage?.reviewsDueWeek ?? null,
    carePlanCoverage,
  };
}
