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

type SupabaseResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string | null;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

type SupabaseBedRow = {
  id: string;
  room_id: string | null;
  bed_label: string | null;
  current_resident_id: string | null;
};

type SupabaseRoomRow = {
  id: string;
  room_number: string | null;
  unit_id: string | null;
};

type SupabaseUnitRow = {
  id: string;
  name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchResidentsFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ResidentRow[]> {
  let residentsQuery = supabase
    .from("residents" as never)
    .select("id, first_name, last_name, facility_id, status, acuity_level, updated_at, deleted_at")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsQuery = residentsQuery.eq("facility_id", selectedFacilityId);
  }

  const residentsResult = (await residentsQuery) as unknown as QueryResult<SupabaseResidentRow>;
  const residents = residentsResult.data ?? [];
  const residentsError = residentsResult.error;
  if (residentsError) {
    throw residentsError;
  }

  if (residents.length === 0) {
    return [];
  }

  const residentIds = residents.map((resident) => resident.id);
  const bedsResult = (await supabase
    .from("beds" as never)
    .select("id, room_id, bed_label, current_resident_id")
    .in("current_resident_id", residentIds)) as unknown as QueryResult<SupabaseBedRow>;
  const beds = bedsResult.data ?? [];
  const bedsError = bedsResult.error;
  if (bedsError) {
    throw bedsError;
  }

  const roomIds = Array.from(
    new Set(
      beds
        .map((bed) => bed.room_id)
        .filter((roomId): roomId is string => Boolean(roomId)),
    ),
  );
  const roomsResult = roomIds.length
    ? ((await supabase
        .from("rooms" as never)
        .select("id, room_number, unit_id")
        .in("id", roomIds)) as unknown as QueryResult<SupabaseRoomRow>)
    : ({ data: [], error: null } as QueryResult<SupabaseRoomRow>);
  const rooms = roomsResult.data ?? [];
  const roomsError = roomsResult.error;
  if (roomsError) {
    throw roomsError;
  }

  const unitIds = Array.from(
    new Set(
      rooms
        .map((room) => room.unit_id)
        .filter((unitId): unitId is string => Boolean(unitId)),
    ),
  );
  const unitsResult = unitIds.length
    ? ((await supabase
        .from("units" as never)
        .select("id, name")
        .in("id", unitIds)) as unknown as QueryResult<SupabaseUnitRow>)
    : ({ data: [], error: null } as QueryResult<SupabaseUnitRow>);
  const units = unitsResult.data ?? [];
  const unitsError = unitsResult.error;
  if (unitsError) {
    throw unitsError;
  }

  const bedByResident = new Map(
    beds
      .filter((bed): bed is SupabaseBedRow & { current_resident_id: string } => Boolean(bed.current_resident_id))
      .map((bed) => [bed.current_resident_id, bed] as const),
  );
  const roomById = new Map(rooms.map((room) => [room.id, room] as const));
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const));

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown Resident";
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";

    const bed = bedByResident.get(resident.id);
    const room = bed?.room_id ? roomById.get(bed.room_id) : null;
    const unit = room?.unit_id ? unitById.get(room.unit_id) : null;

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
