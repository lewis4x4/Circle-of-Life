import { cookies } from "next/headers";

import { AdminRoundingPageClient } from "@/components/rounding/AdminRoundingPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  EMPTY_ROUNDING_SUMMARY,
  fetchRoundingOverviewFromSupabase,
  type RoundingOverviewSummary,
  type RoundingTaskRow,
} from "@/lib/rounding/load-rounding-overview";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/server";

export default async function AdminRoundingPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialSummary: RoundingOverviewSummary = EMPTY_ROUNDING_SUMMARY;
  let initialTaskRows: RoundingTaskRow[] = [];
  let initialError: string | null = null;
  let initialEmptyNotice: string | null = null;

  try {
    const result = await fetchRoundingOverviewFromSupabase(initialFacilityId, supabase);
    initialSummary = result.summary;
    initialTaskRows = result.taskRows;
    initialEmptyNotice = result.emptyNotice;
  } catch (error) {
    initialError = formatLiveDataLoadError(
      error,
      "Could not load Smart Rounding metrics. Confirm the facility scope is set and retry.",
    );
  }

  return (
    <AdminRoundingPageClient
      initialSummary={initialSummary}
      initialTaskRows={initialTaskRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
      initialEmptyNotice={initialEmptyNotice}
    />
  );
}
