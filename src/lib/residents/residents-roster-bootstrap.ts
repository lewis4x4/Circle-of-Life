import { cookies } from "next/headers";

import {
  fetchResidentsFromSupabase,
  type ResidentRow,
} from "@/lib/residents/load-residents";
import {
  composeResidentRosterMetrics,
  fetchResidentRosterMetricInputs,
  type ResidentRosterMetrics,
} from "@/lib/residents/resident-roster-metrics";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { queryErrorMessage } from "@/lib/supabase/query-error";
import { createClient } from "@/lib/supabase/server";

export type ResidentsRosterBootstrap = {
  initialRows: ResidentRow[];
  initialError: string | null;
  initialFacilityId: string | null;
  initialMetrics: ResidentRosterMetrics | null;
};

export async function loadResidentsRosterBootstrap(): Promise<ResidentsRosterBootstrap> {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  // The metric reads (licensed beds, care plans) do not depend on the roster,
  // so they run alongside it instead of after it (COL-674).
  const metricInputsPromise = fetchResidentRosterMetricInputs(initialFacilityId, supabase).catch((error: unknown) => {
    console.error("[Haven] resident roster metrics failed:", queryErrorMessage(error), error);
    return undefined;
  });

  let initialRows: ResidentRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchResidentsFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = formatLiveDataLoadError(error, "Failed to load resident roster.");
    initialRows = [];
  }

  const metricInputs = await metricInputsPromise;
  const initialMetrics: ResidentRosterMetrics | null =
    initialError == null && metricInputs !== undefined
      ? composeResidentRosterMetrics(metricInputs, initialRows.map((row) => row.id))
      : null;

  return { initialRows, initialError, initialFacilityId, initialMetrics };
}
