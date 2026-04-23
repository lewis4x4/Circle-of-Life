import { cookies } from "next/headers";

import { AdminCompliancePageClient } from "@/components/compliance/AdminCompliancePageClient";
import {
  fetchComplianceDashboardSnapshot,
  type ComplianceDashboardSnapshot,
} from "@/lib/compliance-dashboard-snapshot";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

export default async function AdminCompliancePage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialSnapshot: ComplianceDashboardSnapshot | null = null;
  let initialSnapError: string | null = null;

  try {
    initialSnapshot = await fetchComplianceDashboardSnapshot(initialFacilityId, supabase);
  } catch (error) {
    initialSnapError = error instanceof Error ? error.message : "Unable to load compliance metrics.";
  }

  return (
    <AdminCompliancePageClient
      initialSnapshot={initialSnapshot}
      initialSnapError={initialSnapError}
      initialFacilityId={initialFacilityId}
    />
  );
}
