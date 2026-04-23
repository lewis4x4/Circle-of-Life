import { cookies } from "next/headers";

import { AdminIncidentsPageClient } from "@/components/incidents/AdminIncidentsPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchIncidentsFromSupabase,
  type IncidentRow,
} from "@/lib/incidents/load-incidents";
import { createClient } from "@/lib/supabase/server";

export default async function AdminIncidentsPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: IncidentRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchIncidentsFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load incidents";
  }

  return (
    <AdminIncidentsPageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
      initialDemoFallback={false}
    />
  );
}
