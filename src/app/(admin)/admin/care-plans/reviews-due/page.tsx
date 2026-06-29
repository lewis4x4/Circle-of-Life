import { cookies } from "next/headers";

import { CarePlanReviewsDuePageClient } from "@/components/care-plans/CarePlanReviewsDuePageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchCarePlanReviewsDue,
  type CarePlanReviewDueRow,
} from "@/lib/care-plans/reviews-due";
import { createClient } from "@/lib/supabase/server";

export default async function CarePlanReviewsDuePage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: CarePlanReviewDueRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchCarePlanReviewsDue(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Unable to load care plan reviews.";
  }

  return (
    <CarePlanReviewsDuePageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
