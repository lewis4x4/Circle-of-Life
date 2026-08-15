import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { throwIfQueryError } from "@/lib/supabase/query-error";
import { formatLoadResidentsFullName } from "@/lib/residents/load-residents-display-copy";
import { mapResidencyStatus, type ResidencyStatus } from "@/lib/residents/presence";
import type { Database } from "@/types/database";

export type Acuity = 1 | 2 | 3;
export type AdlStatus = "independent" | "assisted" | "dependent";
export type { ResidencyStatus };

export type ResidentRow = {
  id: string;
  name: string;
  initials: string;
  room: string;
  /** Empty when the bed is not linked to a named unit row (UI omits instead of printing "Unassigned"). */
  unit: string;
  acuity: Acuity;
  adlStatus: AdlStatus;
  status: ResidencyStatus;
  careSummary: string;
  /** Raw `residents.updated_at` for operator-facing "last profile save" column. */
  updatedAtIso: string | null;
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
      `id, first_name, last_name, facility_id, status, acuity_level, updated_at, deleted_at,
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

    // A resident is assigned to at most one bed; the nested array will
    // normally hold one row. If a stale row is returned we take the first.
    const bed = resident.beds?.[0] ?? null;
    const room = bed?.rooms ?? null;
    const unit = room?.units ?? null;

    const acuity = mapAcuity(resident.acuity_level);
    const status = mapResidencyStatus(resident.status);

    return {
      id: resident.id,
      name: fullName,
      initials,
      room: room?.room_number ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}` : "No bed linked",
      unit: (unit?.name ?? "").trim(),
      acuity,
      adlStatus: mapAdlStatusFromAcuity(acuity),
      status,
      careSummary: "",
      updatedAtIso: resident.updated_at ?? null,
    } satisfies ResidentRow;
  });
}

function mapAcuity(value: string | null): Acuity {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function mapAdlStatusFromAcuity(acuity: Acuity): AdlStatus {
  if (acuity === 3) return "dependent";
  if (acuity === 2) return "assisted";
  return "independent";
}
