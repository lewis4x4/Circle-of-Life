import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { throwIfQueryError } from "@/lib/supabase/query-error";
import { formatLoadResidentsFullName } from "@/lib/residents/load-residents-display-copy";
import { isBedHoldStayType, mapResidencyStatus, type BedHoldStayType, type ResidencyStatus } from "@/lib/residents/presence";
import { parseDocumentedAcuityLevel } from "@/lib/residents/resident-acuity-display";
import { RESIDENT_NO_BED_COPY } from "@/lib/residents/roster-display-copy";
import type { Database } from "@/types/database";

export type Acuity = 1 | 2 | 3;
export type AdlStatus = "independent" | "assisted" | "dependent";
export type { ResidencyStatus };

export type ResidentRow = {
  id: string;
  facilityId?: string | null;
  name: string;
  initials: string;
  room: string;
  /** Empty when the bed is not linked to a named unit row (UI omits instead of printing "Unassigned"). */
  unit: string;
  acuity: Acuity;
  /** Raw `residents.acuity_level` — null when acuity was never posted. */
  acuityLevel: string | null;
  adlStatus: AdlStatus;
  status: ResidencyStatus;
  careSummary: string;
  /** Raw `residents.updated_at` for operator-facing "last profile save" column. */
  updatedAtIso: string | null;
  /**
   * COL-750: when the current status actually began (`residents.status_effective_at`),
   * which is the time staff entered for a back-dated change. Null when the status
   * has not changed since that column existed.
   */
  statusSinceIso?: string | null;
  /** COL-755: hospital or rehab for a bed-hold stay; null when not recorded or not on a stay. */
  bedHoldStayType?: BedHoldStayType | null;
};

type SupabaseUnitJoin = {
  id: string;
  name: string | null;
};

type SupabaseRoomJoin = {
  id: string;
  room_number: string | null;
  unit_id: string | null;
  units: SupabaseUnitJoin | null;
};

type SupabaseBedJoin = {
  id: string;
  bed_label: string | null;
  room_id: string | null;
  rooms: SupabaseRoomJoin | null;
};

type SupabaseResidentJoined = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string | null;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  status_effective_at?: string | null;
  bed_hold_stay_type?: string | null;
  /** The bed the resident record points at (`residents.bed_id`). */
  bed_by_id: SupabaseBedJoin | null;
  /** Beds whose `current_resident_id` points back at the resident. */
  beds: SupabaseBedJoin[] | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchResidentsFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ResidentRow[]> {
  // Single nested-select replaces the old residents → beds → rooms → units
  // four-step chain. PostgREST walks the FK graph
  // (beds.current_resident_id → residents, beds.room_id → rooms,
  // rooms.unit_id → units) in a single round-trip. RLS still applies to
  // every joined table.
  let residentsQuery = supabase
    .from("residents" as never)
    .select(
      `id, first_name, last_name, facility_id, status, acuity_level, updated_at, deleted_at, status_effective_at, bed_hold_stay_type,
       bed_by_id: beds!residents_bed_id_fkey (
         id, bed_label, room_id,
         rooms ( id, room_number, unit_id, units ( id, name ) )
       ),
       beds!fk_beds_resident (
         id, bed_label, room_id,
         rooms ( id, room_number, unit_id, units ( id, name ) )
       )`,
    )
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsQuery = residentsQuery.eq("facility_id", selectedFacilityId);
  }

  const residentsResult = (await residentsQuery) as unknown as QueryResult<SupabaseResidentJoined>;
  const residents = residentsResult.data ?? [];
  throwIfQueryError(residentsResult.error, "residents roster");

  if (residents.length === 0) {
    return [];
  }

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = formatLoadResidentsFullName(firstName, lastName);
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";

    // Same bed resolution as the resident overview (resident-detail-overview-load):
    // the record's own bed_id first, then a bed pointing back at the resident,
    // so the roster and the record never name different rooms.
    const bed = resident.bed_by_id ?? resident.beds?.[0] ?? null;
    const room = bed?.rooms ?? null;
    const unit = room?.units ?? null;

    const acuity = mapAcuity(resident.acuity_level);
    const status = mapResidencyStatus(resident.status);

    return {
      id: resident.id,
      facilityId: resident.facility_id,
      name: fullName,
      initials,
      room: room?.room_number ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}` : RESIDENT_NO_BED_COPY,
      unit: (unit?.name ?? "").trim(),
      acuity,
      acuityLevel: resident.acuity_level,
      adlStatus: mapAdlStatusFromAcuity(acuity),
      status,
      careSummary: "",
      updatedAtIso: resident.updated_at ?? null,
      statusSinceIso: resident.status_effective_at ?? null,
      bedHoldStayType: status === "hospital" && isBedHoldStayType(resident.bed_hold_stay_type) ? resident.bed_hold_stay_type : null,
    } satisfies ResidentRow;
  });
}

/** Sort/filter level; callers must read `acuityLevel` to tell "not recorded" from level 1. */
function mapAcuity(value: string | null): Acuity {
  return parseDocumentedAcuityLevel(value) ?? 1;
}

function mapAdlStatusFromAcuity(acuity: Acuity): AdlStatus {
  if (acuity === 3) return "dependent";
  if (acuity === 2) return "assisted";
  return "independent";
}
