import { cookies } from "next/headers";

import { AdminReferralsPageClient } from "@/components/referrals/AdminReferralsPageClient";
import {
  emptyReferralsHubBootstrap,
  loadReferralsHubBootstrap,
  type ReferralsHubBootstrap,
} from "@/lib/referrals/referrals-hub-bootstrap";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

export default async function AdminReferralsHubPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  let initialBootstrap: ReferralsHubBootstrap = emptyReferralsHubBootstrap();
  let initialLoadError: string | null = null;

  try {
    const supabase = await createClient();
    initialBootstrap = await loadReferralsHubBootstrap(initialFacilityId, supabase);
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : "Could not load referrals.";
  }

  return (
    <AdminReferralsPageClient
      initialBootstrap={initialBootstrap}
      initialLoadError={initialLoadError}
      initialFacilityId={initialFacilityId}
      serverBootstrapped
    />
  );
}
