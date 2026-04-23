import { cookies } from "next/headers";

import { AdminStaffingConsolePageClient } from "@/components/staffing/AdminStaffingConsolePageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  loadStaffingConsole,
  type StaffingConsoleData,
} from "@/lib/staffing/load-staffing-console";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DATA: StaffingConsoleData = {
  snapshots: [],
  certWarnings: [],
  shiftGaps: [],
  staffOptions: [],
  requisitions: [],
  attendance: [],
};

export default async function AdminStaffingPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let data: StaffingConsoleData = EMPTY_DATA;
  let initialError: string | null = null;

  try {
    data = await loadStaffingConsole(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load staffing metrics";
  }

  return (
    <AdminStaffingConsolePageClient
      initialSnapshots={data.snapshots}
      initialCertWarnings={data.certWarnings}
      initialShiftGaps={data.shiftGaps}
      initialStaffOptions={data.staffOptions}
      initialRequisitions={data.requisitions}
      initialAttendance={data.attendance}
      initialError={initialError}
      initialFacilityId={initialFacilityId}
    />
  );
}
