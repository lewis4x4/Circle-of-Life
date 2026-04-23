import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type Acuity = 1 | 2 | 3;
export type AdlStatus = "independent" | "assisted" | "dependent";
export type ResidencyStatus = "active" | "hospital" | "loa";

export type ResidentRow = {
  id: string;
  name: string;
  initials: string;
  room: string;
  unit: string;
  acuity: Acuity;
  adlStatus: AdlStatus;
  status: ResidencyStatus;
  careSummary: string;
  updatedAt: string;
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
  const residentsError = residentsResult.error;
  if (residentsError) {
    throw residentsError;
  }

  if (residents.length === 0) {
    return [];
  }

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown Resident";
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
      room: room?.room_number ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}` : "Unassigned",
      unit: unit?.name ?? "Unassigned",
      acuity,
      adlStatus: mapAdlStatusFromAcuity(acuity),
      status,
      careSummary: buildCareSummary(status, acuity),
      updatedAt: formatUpdatedAt(resident.updated_at),
    } satisfies ResidentRow;
  });
}

function mapAcuity(value: string | null): Acuity {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function mapResidencyStatus(value: string | null): ResidencyStatus {
  if (value === "hospital_hold") return "hospital";
  if (value === "loa") return "loa";
  return "active";
}

function mapAdlStatusFromAcuity(acuity: Acuity): AdlStatus {
  if (acuity === 3) return "dependent";
  if (acuity === 2) return "assisted";
  return "independent";
}

function buildCareSummary(status: ResidencyStatus, acuity: Acuity): string {
  if (status === "hospital") return "Hospital hold - return coordination in progress";
  if (status === "loa") return "Approved leave of absence";
  if (acuity === 3) return "Enhanced monitoring and transfer support";
  if (acuity === 2) return "Routine assisted ADL support";
  return "Independent daily routine";
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
