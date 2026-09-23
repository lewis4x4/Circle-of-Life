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
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function AdminCompliancePage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  let initialSnapshot: ComplianceDashboardSnapshot | null = null;
  let initialSnapError: string | null = null;

  // The hub is per-facility; with no facility the tiles say so instead of
  // showing organisation-wide counts under a facility-gate banner (COL-649).
  if (isValidFacilityIdForQuery(initialFacilityId)) {
    try {
      const supabase = await createClient();
      initialSnapshot = await fetchComplianceDashboardSnapshot(initialFacilityId, supabase);
    } catch (error) {
      initialSnapError = error instanceof Error ? error.message : "Unable to load compliance metrics.";
    }
  }

  return (
    <AdminCompliancePageClient
      initialSnapshot={initialSnapshot}
      initialSnapError={initialSnapError}
      initialFacilityId={initialFacilityId}
    />
  );
}
