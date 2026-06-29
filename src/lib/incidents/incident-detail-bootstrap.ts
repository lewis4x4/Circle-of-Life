import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  loadIncidentDetail,
  type IncidentDetailView,
} from "@/lib/incidents/load-incident-detail";
import { createClient } from "@/lib/supabase/server";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type IncidentDetailBootstrap = {
  initialDetail: IncidentDetailView | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

export async function loadIncidentDetailBootstrap(
  incidentId: string,
  initialFacilityId: string | null,
  supabase?: SupabaseClient<Database>,
): Promise<IncidentDetailBootstrap> {
  if (!incidentId || !UUID_STRING_RE.test(incidentId)) {
    return { initialDetail: null, initialError: null, initialFacilityId };
  }

  const client = supabase ?? (await createClient());
  let initialDetail: IncidentDetailView | null = null;
  let initialError: string | null = null;

  try {
    initialDetail = await loadIncidentDetail(incidentId, initialFacilityId, client);
  } catch (error) {
    initialError = formatLiveDataLoadError(
      error,
      "Incident record could not be loaded. Try again or return to the queue.",
    );
  }

  return { initialDetail, initialError, initialFacilityId };
}
