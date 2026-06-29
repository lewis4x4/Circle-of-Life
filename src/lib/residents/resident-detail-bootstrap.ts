import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  loadResidentOverviewDetail,
  type ResidentOverviewDetail,
} from "@/lib/residents/resident-detail-overview-load";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ResidentDetailBootstrap = {
  initialDetail: ResidentOverviewDetail | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

export async function loadResidentDetailBootstrap(
  residentId: string,
  initialFacilityId: string | null,
  supabase?: SupabaseClient<Database>,
): Promise<ResidentDetailBootstrap> {
  const client = supabase ?? (await createClient());
  let initialDetail: ResidentOverviewDetail | null = null;
  let initialError: string | null = null;

  try {
    initialDetail = await loadResidentOverviewDetail(
      residentId,
      initialFacilityId,
      client,
    );
  } catch (error) {
    initialError = formatLiveDataLoadError(
      error,
      "Live resident profile is unavailable right now.",
    );
  }

  return { initialDetail, initialError, initialFacilityId };
}
