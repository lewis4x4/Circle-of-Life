import { cookies } from "next/headers";

import { AdminSchedulesPageClient } from "@/components/schedules/AdminSchedulesPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchSchedulesFromSupabase,
  type ScheduleRow,
} from "@/lib/schedules/load-schedules";
import { createClient } from "@/lib/supabase/server";

export default async function AdminSchedulesPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: ScheduleRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchSchedulesFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <AdminSchedulesPageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
