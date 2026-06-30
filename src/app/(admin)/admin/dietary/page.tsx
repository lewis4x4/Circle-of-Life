import { cookies } from "next/headers";

import { AdminDietaryPageClient } from "@/components/dietary/AdminDietaryPageClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  emptyDietaryHubBootstrap,
  loadDietaryHubBootstrap,
  type DietaryHubBootstrap,
} from "@/lib/dietary/load-dietary-hub-bootstrap";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDietaryHubPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  let initialBootstrap: DietaryHubBootstrap = emptyDietaryHubBootstrap();
  let initialLoadError: string | null = null;

  try {
    const supabase = await createClient();
    initialBootstrap = await loadDietaryHubBootstrap(initialFacilityId, supabase);
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : "Could not load dietary hub.";
  }

  return (
    <AdminDietaryPageClient
      initialBootstrap={initialBootstrap}
      initialLoadError={initialLoadError}
      initialFacilityId={initialFacilityId}
      serverBootstrapped
    />
  );
}
