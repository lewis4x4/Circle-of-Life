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

/** The facility-level reads behind the roster metrics; independent of the roster itself. */
export type ResidentRosterMetricInputs = {
  licensedBeds: number | null;
  /** Null when the care-plan read failed. */
  plans: CarePlanCoverageRow[] | null;
  today: string;
  horizon: string;
};

/**
 * Reads licensed beds and the facility's active plans in parallel. Neither
 * depends on the roster, so callers can start this alongside the roster read
 * and combine the two with composeResidentRosterMetrics (COL-674).
 */
export async function fetchResidentRosterMetricInputs(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<ResidentRosterMetricInputs | null> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) return null;

  const today = startOfTodayIsoDate();
  const horizon = addDaysIsoDate(today, 7);

  const readLicensedBeds = async (): Promise<number | null> => {
    try {
      const fac = await supabase
        .from("facilities" as never)
        .select("total_licensed_beds")
        .eq("id", selectedFacilityId)
        .maybeSingle();
      if (fac.error) {
        console.error("[Haven] licensed beds lookup failed:", queryErrorMessage(fac.error), fac.error);
        return null;
      }
      const n = (fac.data as { total_licensed_beds: number | null } | null)?.total_licensed_beds;
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    } catch (error) {
      console.error("[Haven] licensed beds lookup failed:", queryErrorMessage(error), error);
      return null;
    }
  };

  const readPlans = async (): Promise<CarePlanCoverageRow[] | null> => {
    try {
      const plans = await supabase
        .from("care_plans" as never)
        .select("resident_id, review_due_date")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["active", "under_review"]);
      if (plans.error) {
        console.error("[Haven] care plan coverage failed:", queryErrorMessage(plans.error), plans.error);
        return null;
      }
      return (plans.data as CarePlanCoverageRow[] | null) ?? [];
    } catch (error) {
      console.error("[Haven] care plan coverage failed:", queryErrorMessage(error), error);
      return null;
    }
  };

  const [licensedBeds, plans] = await Promise.all([readLicensedBeds(), readPlans()]);
  return { licensedBeds, plans, today, horizon };
}

/** Combines the facility reads with the roster's resident ids. Pure. */
export function composeResidentRosterMetrics(
  inputs: ResidentRosterMetricInputs | null,
  rosterResidentIds: string[],
): ResidentRosterMetrics {
  const occupiedResidents = rosterResidentIds.length;
  if (!inputs) {
    return {
      licensedBeds: null,
      occupiedResidents,
      openBeds: null,
      carePlanReviewsDueWeek: null,
      carePlanCoverage: null,
    };
  }
  const { licensedBeds } = inputs;
  const openBeds =
    licensedBeds != null ? Math.max(0, licensedBeds - occupiedResidents) : null;
  const carePlanCoverage = inputs.plans
    ? classifyCarePlanCoverage(inputs.plans, rosterResidentIds, inputs.today, inputs.horizon)
    : null;
  return {
    licensedBeds,
    occupiedResidents,
    openBeds,
    carePlanReviewsDueWeek: carePlanCoverage?.reviewsDueWeek ?? null,
    carePlanCoverage,
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
  return composeResidentRosterMetrics(
    await fetchResidentRosterMetricInputs(selectedFacilityId, supabase),
    rosterResidentIds,
  );
}
