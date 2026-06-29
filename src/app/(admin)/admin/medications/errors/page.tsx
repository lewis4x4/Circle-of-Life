import { cookies } from "next/headers";

import { AdminMedicationErrorsPageClient } from "@/components/medications/AdminMedicationErrorsPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchMedicationErrors,
  type MedicationErrorRow,
} from "@/lib/medications/load-medication-errors";
import { createClient } from "@/lib/supabase/server";

export default async function AdminMedicationErrorsPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: MedicationErrorRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchMedicationErrors(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Load failed";
  }

  return (
    <AdminMedicationErrorsPageClient
      initialRows={initialRows}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
