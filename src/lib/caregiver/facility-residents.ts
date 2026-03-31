import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type ResidentWithRoom = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  roomLabel: string;
  displayName: string;
};

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
};

type BedRow = { id: string; room_id: string | null; bed_label: string };
type RoomRow = { id: string; room_number: string };

/**
 * Active census for a facility with room labels (bed → room), for floor apps.
 */
export async function fetchActiveResidentsWithRooms(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  limit = 80,
): Promise<ResidentWithRoom[]> {
  const resQ = await supabase
    .from("residents")
    .select("id, first_name, last_name, bed_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .order("last_name", { ascending: true })
    .limit(limit);

  if (resQ.error) throw resQ.error;
  const residents = (resQ.data ?? []) as ResidentRow[];
  if (residents.length === 0) return [];

  const bedIds = [...new Set(residents.map((r) => r.bed_id).filter(Boolean))] as string[];
  const roomByResident = new Map<string, string>();

  if (bedIds.length > 0) {
    const bedsQ = await supabase
      .from("beds")
      .select("id, room_id, bed_label")
      .in("id", bedIds)
      .is("deleted_at", null);
    if (bedsQ.error) throw bedsQ.error;
    const beds = (bedsQ.data ?? []) as BedRow[];
    const roomIds = [...new Set(beds.map((b) => b.room_id).filter(Boolean))] as string[];
    let roomById = new Map<string, RoomRow>();
    if (roomIds.length > 0) {
      const roomsQ = await supabase.from("rooms").select("id, room_number").in("id", roomIds).is("deleted_at", null);
      if (roomsQ.error) throw roomsQ.error;
      roomById = new Map((roomsQ.data ?? []).map((r) => [r.id, r as RoomRow]));
    }
    const bedById = new Map(beds.map((b) => [b.id, b]));
    for (const r of residents) {
      if (!r.bed_id) {
        roomByResident.set(r.id, "—");
        continue;
      }
      const bed = bedById.get(r.bed_id);
      const room = bed?.room_id ? roomById.get(bed.room_id) : null;
      const label = room?.room_number
        ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
        : "—";
      roomByResident.set(r.id, label);
    }
  } else {
    for (const r of residents) roomByResident.set(r.id, "—");
  }

  return residents.map((r) => {
    const fn = r.first_name?.trim() ?? "";
    const ln = r.last_name?.trim() ?? "";
    const displayName = `${fn} ${ln}`.trim() || "Resident";
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      roomLabel: roomByResident.get(r.id) ?? "—",
      displayName,
    };
  });
}
