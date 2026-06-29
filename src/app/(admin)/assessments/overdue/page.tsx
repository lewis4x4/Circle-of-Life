import { cookies } from "next/headers";

import { AdminOverdueAssessmentsPageClient } from "@/components/assessments/AdminOverdueAssessmentsPageClient";
import {
  fetchCarePlanReviewsDueFromSupabase,
  fetchOverdueAssessmentsFromSupabase,
  NO_FACILITY_SOURCE_NOTICE,
  type CarePlanReviewDueRow,
  type OverdueAssessmentRow,
} from "@/lib/assessments/load-overdue-assessments";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function OverdueAssessmentsPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialAssessments: OverdueAssessmentRow[] = [];
  let initialCarePlans: CarePlanReviewDueRow[] = [];
  let initialError: string | null = null;
  let initialSourceNotice: string | null = null;

  if (!isValidFacilityIdForQuery(initialFacilityId)) {
    initialSourceNotice = NO_FACILITY_SOURCE_NOTICE;
  } else {
    try {
      [initialAssessments, initialCarePlans] = await Promise.all([
        fetchOverdueAssessmentsFromSupabase(initialFacilityId, supabase),
        fetchCarePlanReviewsDueFromSupabase(initialFacilityId, supabase),
      ]);
    } catch (error) {
      initialError =
        error instanceof Error ? error.message : "Failed to load Clinical Desk";
    }
  }

  return (
    <AdminOverdueAssessmentsPageClient
      initialAssessments={initialAssessments}
      initialCarePlans={initialCarePlans}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
      initialSourceNotice={initialSourceNotice}
    />
  );
}
