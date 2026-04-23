import { cookies } from "next/headers";

import { AdminResidentsPageClient } from "@/components/residents/AdminResidentsPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchResidentsFromSupabase,
  type ResidentRow,
} from "@/lib/residents/load-residents";
import { createClient } from "@/lib/supabase/server";

export default async function AdminResidentsPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: ResidentRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchResidentsFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <AdminResidentsPageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
      initialDemoFallback={false}
    />
  );
}
