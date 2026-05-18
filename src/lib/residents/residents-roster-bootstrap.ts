import { cookies } from "next/headers";

import {
  fetchResidentsFromSupabase,
  type ResidentRow,
} from "@/lib/residents/load-residents";
import {
  fetchResidentRosterMetrics,
  type ResidentRosterMetrics,
} from "@/lib/residents/resident-roster-metrics";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
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
  let initialRows: ResidentRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchResidentsFromSupabase(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
    initialRows = [];
  }

  let initialMetrics: ResidentRosterMetrics | null = null;

  try {
    if (initialError == null) {
      initialMetrics = await fetchResidentRosterMetrics(initialFacilityId, initialRows.length, supabase);
    }
  } catch {
    initialMetrics = null;
  }

  return { initialRows, initialError, initialFacilityId, initialMetrics };
}
