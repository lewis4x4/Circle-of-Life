import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type ComplianceDashboardSnapshot = {
  overdueAssessments: number;
  overdueCarePlanReviews: number;
  openIncidentFollowupsPastDue: number;
  activeInfections: number;
  activeOutbreaks: number;
  expiringCertifications30d: number;
  openDeficiencies: number;
  surveyVisitActive: boolean;
};

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISODate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Latest assessment per (resident_id, assessment_type); count overdue next_due_date. */
export function countOverdueAssessments(
  rows: {
    resident_id: string;
    assessment_type: string;
    assessment_date: string;
    next_due_date: string | null;
  }[],
): number {
  const latestByKey = new Map<
    string,
    { resident_id: string; assessment_type: string; assessment_date: string; next_due_date: string | null }
  >();
  for (const r of rows) {
    const key = `${r.resident_id}\0${r.assessment_type}`;
    const prev = latestByKey.get(key);
    if (!prev || r.assessment_date > prev.assessment_date) {
      latestByKey.set(key, r);
    }
  }
  const today = todayISODate();
  let n = 0;
  for (const r of latestByKey.values()) {
    if (r.next_due_date !== null && r.next_due_date < today) {
      n += 1;
    }
  }
  return n;
}

export async function fetchComplianceDashboardSnapshot(
  selectedFacilityId: string | null,
): Promise<ComplianceDashboardSnapshot> {
  const supabase = createClient();
  const facilityFilter = isValidFacilityIdForQuery(selectedFacilityId);

  const today = todayISODate();
  const in30 = addDaysISODate(30);

  let assessmentsQuery = supabase
    .from("assessments")
    .select("resident_id, assessment_type, assessment_date, next_due_date")
    .is("deleted_at", null);

  let carePlansQuery = supabase
    .from("care_plans")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("deleted_at", null)
    .lt("review_due_date", today);

  let followupsQuery = supabase
    .from("incident_followups")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("completed_at", null)
    .lt("due_at", new Date().toISOString());

  let surveillanceQuery = supabase
    .from("infection_surveillance")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["suspected", "confirmed"]);

  let outbreaksQuery = supabase
    .from("infection_outbreaks")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["active", "contained"]);

  let certsQuery = supabase
    .from("staff_certifications")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "active")
    .not("expiration_date", "is", null)
    .gte("expiration_date", today)
    .lte("expiration_date", in30);

  let deficienciesQuery = supabase
    .from("survey_deficiencies")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["open", "poc_submitted", "poc_accepted", "recited"]);

  if (facilityFilter) {
    assessmentsQuery = assessmentsQuery.eq("facility_id", selectedFacilityId!);
    carePlansQuery = carePlansQuery.eq("facility_id", selectedFacilityId!);
    followupsQuery = followupsQuery.eq("facility_id", selectedFacilityId!);
    surveillanceQuery = surveillanceQuery.eq("facility_id", selectedFacilityId!);
    outbreaksQuery = outbreaksQuery.eq("facility_id", selectedFacilityId!);
    certsQuery = certsQuery.eq("facility_id", selectedFacilityId!);
    deficienciesQuery = deficienciesQuery.eq("facility_id", selectedFacilityId!);
  }

  const sessionPromise = facilityFilter
    ? supabase
        .from("survey_visit_sessions")
        .select("id")
        .eq("facility_id", selectedFacilityId!)
        .is("deactivated_at", null)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null as null });

  const [
    assessmentsRes,
    carePlansRes,
    followupsRes,
    surveillanceRes,
    outbreaksRes,
    certsRes,
    deficienciesRes,
    sessionRes,
  ] = await Promise.all([
    assessmentsQuery,
    carePlansQuery,
    followupsQuery,
    surveillanceQuery,
    outbreaksQuery,
    certsQuery,
    deficienciesQuery,
    sessionPromise,
  ]);

  if (assessmentsRes.error) throw assessmentsRes.error;
  if (carePlansRes.error) throw carePlansRes.error;
  if (followupsRes.error) throw followupsRes.error;
  if (surveillanceRes.error) throw surveillanceRes.error;
  if (outbreaksRes.error) throw outbreaksRes.error;
  if (certsRes.error) throw certsRes.error;
  if (deficienciesRes.error) throw deficienciesRes.error;
  if (sessionRes.error) throw sessionRes.error;

  const assessmentRows = assessmentsRes.data ?? [];
  const overdueAssessments = Array.isArray(assessmentRows)
    ? countOverdueAssessments(
        assessmentRows as {
          resident_id: string;
          assessment_type: string;
          assessment_date: string;
          next_due_date: string | null;
        }[],
      )
    : 0;

  return {
    overdueAssessments,
    overdueCarePlanReviews: carePlansRes.count ?? 0,
    openIncidentFollowupsPastDue: followupsRes.count ?? 0,
    activeInfections: surveillanceRes.count ?? 0,
    activeOutbreaks: outbreaksRes.count ?? 0,
    expiringCertifications30d: certsRes.count ?? 0,
    openDeficiencies: deficienciesRes.count ?? 0,
    surveyVisitActive: !!sessionRes.data,
  };
}
