import { cookies } from "next/headers";

import { AdminStaffPageClient } from "@/components/staff/AdminStaffPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { fetchStaffFromSupabase, type StaffRow } from "@/lib/staff/load-staff";
import { createClient } from "@/lib/supabase/server";

export default async function AdminStaffPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: StaffRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchStaffFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <AdminStaffPageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
