import type { SupabaseClient } from "@supabase/supabase-js";

import {
  facilityOccupiedCount,
  facilityPortfolioOccupancyPct,
  facilityOccupancyLoaded,
} from "@/lib/admin/facilities/portfolio-hub-kpi-copy";
import type { FacilityRow } from "@/types/facility";
import type { Database } from "@/types/database";

export type FacilityBedCensus = {
  total_beds: number;
  occupancy_count: number;
};

type FacilityLicensedRow = {
  id: string;
  total_licensed_beds?: number | null;
};

type BedRow = {
  facility_id: string;
  current_resident_id: string | null;
};

export function aggregateBedCensusByFacility(beds: BedRow[]): Map<string, FacilityBedCensus> {
  const map = new Map<string, FacilityBedCensus>();
  for (const bed of beds) {
    const current = map.get(bed.facility_id) ?? { total_beds: 0, occupancy_count: 0 };
    current.total_beds += 1;
    if (bed.current_resident_id) current.occupancy_count += 1;
    map.set(bed.facility_id, current);
  }
  return map;
}

export async function fetchFacilityBedCensusById(
  supabase: SupabaseClient<Database>,
  facilityIds: string[],
): Promise<Map<string, FacilityBedCensus>> {
  if (facilityIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("beds")
    .select("facility_id, current_resident_id")
    .in("facility_id", facilityIds);

  if (error) throw new Error(error.message);
  return aggregateBedCensusByFacility((data ?? []) as BedRow[]);
}

function facilityRowFromBedCensus(
  facility: FacilityLicensedRow,
  census: FacilityBedCensus | undefined,
): FacilityRow {
  return {
    id: facility.id,
    total_licensed_beds: facility.total_licensed_beds ?? 0,
    total_beds: census?.total_beds ?? 0,
    occupancy_count: census?.occupancy_count ?? 0,
  } as FacilityRow;
}

/** Same loaded signal as the facilities portfolio hub (`total_beds` grid or occupied count). */
export function isFacilityOccupancyCensusLoaded(
  facility: FacilityLicensedRow,
  census: FacilityBedCensus | undefined,
): boolean {
  return facilityOccupancyLoaded(facilityRowFromBedCensus(facility, census));
}

export function computeFacilityOccupiedResidents(
  facility: FacilityLicensedRow,
  census: FacilityBedCensus | undefined,
): number {
  return facilityOccupiedCount(facilityRowFromBedCensus(facility, census));
}

/** Portfolio occupancy % — null when bed census is not loaded; real 0% when loaded and empty. */
export function computeFacilityOccupancyPct(
  facility: FacilityLicensedRow,
  census: FacilityBedCensus | undefined,
): number | null {
  return facilityPortfolioOccupancyPct(facilityRowFromBedCensus(facility, census));
}

/** `occ_pt` executive snapshot metric (0–1 decimal) when census is loaded. */
export function facilityOccPtMetricValue(
  facility: FacilityLicensedRow,
  census: FacilityBedCensus | undefined,
): number | undefined {
  const pct = computeFacilityOccupancyPct(facility, census);
  if (pct == null) return undefined;
  return pct / 100;
}
