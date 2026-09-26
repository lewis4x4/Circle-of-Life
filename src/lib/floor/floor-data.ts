/**
 * Reads behind the floor tablet screens (spec 40 §6). Every read goes through
 * the signed-in person's session and RLS; nothing here widens what they could
 * see on the caregiver app. The census and statuses come from the same tables
 * the rounding live board reads.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { liveBoardRungLabel } from "@/lib/rounding/live-board-display-copy";
import { FLOOR_CHECK_VOCAB_FIELDS, floorCheckVocabFromRows, type FloorVocabRow } from "@/lib/floor/check-form";
import { compareRooms, residentFlag, type FloorTaskApiRow, type ResidentFlag } from "@/lib/floor/now-rows";
import type { ObservationVocabCatalog } from "@/lib/rounding/observation-chips";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type FloorResident = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  room: string | null;
  status: string;
};

type CensusRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  status: string;
  beds: { bed_label: string | null; room_id: string | null; rooms: { room_number: string | null } | null } | null;
};

/**
 * How the floor names a resident's room: the room number alone ("101"), with
 * the bed only when that room has more than one bed ("102-A"), so a shared
 * room stays unambiguous. Null when no room is on record.
 */
export function floorRoomLabel(input: { roomNumber: string | null | undefined; bedLabel: string | null | undefined; bedsInRoom: number }): string | null {
  const room = input.roomNumber?.trim();
  if (!room) return null;
  const bed = input.bedLabel?.trim();
  return input.bedsInRoom > 1 && bed ? `${room}-${bed}` : room;
}

/** Residents in the building or holding a bed (hospital, leave), in room order. */
export async function fetchFloorCensus(supabase: Client, facilityId: string): Promise<FloorResident[]> {
  const { data, error } = await supabase
    .from("residents" as never)
    .select("id, first_name, last_name, preferred_name, status, beds!residents_bed_id_fkey(bed_label, room_id, rooms(room_number))")
    .eq("facility_id", facilityId)
    .in("status", ["active", "hospital_hold", "loa"])
    .is("deleted_at", null)
    .limit(300);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CensusRow[];
  // Beds per room, so a shared room names the bed and a single room does not.
  const roomIds = [...new Set(rows.map((row) => row.beds?.room_id).filter((id): id is string => Boolean(id)))];
  const bedsPerRoom = new Map<string, number>();
  if (roomIds.length > 0) {
    const beds = await supabase.from("beds").select("room_id").in("room_id", roomIds).is("deleted_at", null);
    if (beds.error) throw beds.error;
    for (const bed of beds.data ?? []) {
      if (!bed.room_id) continue;
      const counted = bedsPerRoom.get(bed.room_id);
      bedsPerRoom.set(bed.room_id, counted === undefined ? 1 : counted + 1);
    }
  }
  return rows
    .map((row) => {
      const first = row.preferred_name?.trim() || row.first_name?.trim() || "";
      const last = row.last_name?.trim() || "";
      return {
        id: row.id,
        name: `${first} ${last}`.trim() || "Resident",
        firstName: row.first_name,
        lastName: row.last_name,
        room: floorRoomLabel({
          roomNumber: row.beds?.rooms?.room_number,
          bedLabel: row.beds?.bed_label,
          bedsInRoom: row.beds?.room_id ? (bedsPerRoom.get(row.beds.room_id) ?? 1) : 1,
        }),
        status: row.status,
      };
    })
    .sort((a, b) => compareRooms(a.room, b.room) || a.name.localeCompare(b.name));
}

export type ResidentStatusSignals = {
  escalations: Map<string, { count: number; label: string }>;
  watches: Map<string, { count: number; label: string; endsAt: string | null }>;
};

/** Open escalations and active watches per resident: the alert and watch dots. */
export async function fetchResidentStatusSignals(supabase: Client, facilityId: string, now: Date = new Date()): Promise<ResidentStatusSignals> {
  const [escalations, watches] = await Promise.all([
    supabase
      .from("resident_observation_escalations" as never)
      .select("resident_id, rung_key, triggered_at")
      .eq("facility_id", facilityId)
      .in("status", ["open", "in_progress"])
      .is("deleted_at", null)
      .order("triggered_at", { ascending: false })
      .limit(1000),
    supabase
      .from("resident_watch_instances" as never)
      .select("resident_id, ends_at, protocol_id")
      .eq("facility_id", facilityId)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(500),
  ]);
  if (escalations.error) throw escalations.error;
  if (watches.error) throw watches.error;

  const escalationMap = new Map<string, { count: number; label: string }>();
  for (const row of (escalations.data ?? []) as unknown as { resident_id: string; rung_key: string | null }[]) {
    const existing = escalationMap.get(row.resident_id);
    if (existing) existing.count += 1;
    else escalationMap.set(row.resident_id, { count: 1, label: liveBoardRungLabel(row.rung_key) });
  }
  type WatchRow = { resident_id: string; ends_at: string | null; protocol_id: string | null };
  const watchRows = ((watches.data ?? []) as unknown as WatchRow[]).filter(
    (row) => !row.ends_at || new Date(row.ends_at).getTime() > now.getTime(),
  );
  const protocolIds = [...new Set(watchRows.map((row) => row.protocol_id).filter((id): id is string => Boolean(id)))];
  const protocolNames = new Map<string, string>();
  if (protocolIds.length > 0) {
    const protocols = await supabase.from("resident_watch_protocols").select("id, name").in("id", protocolIds);
    // A missing protocol name only costs the tile its wording; the watch still counts.
    for (const row of protocols.data ?? []) protocolNames.set(row.id, row.name);
  }
  const watchMap = new Map<string, { count: number; label: string; endsAt: string | null }>();
  for (const row of watchRows) {
    const existing = watchMap.get(row.resident_id);
    const label = (row.protocol_id ? protocolNames.get(row.protocol_id)?.trim() : null) || "Watch";
    if (existing) existing.count += 1;
    else watchMap.set(row.resident_id, { count: 1, label, endsAt: row.ends_at });
  }
  return { escalations: escalationMap, watches: watchMap };
}

export function flagFor(resident: FloorResident, signals: ResidentStatusSignals | null): ResidentFlag {
  return residentFlag({
    hasOpenEscalation: signals?.escalations.has(resident.id) === true,
    hasActiveWatch: signals?.watches.has(resident.id) === true,
    status: resident.status,
  });
}

/** The rounding queue for the facility (or one resident), with the server's derived status. */
export type FloorResidentActivity = {
  /** The newest charted check per resident in the last 24 hours. */
  lastCheckAt: Map<string, string>;
  /** Residents with a visitor signed in for them and not yet signed out. */
  visitorHere: Set<string>;
};

/**
 * The Residents list's "Checked 2:40 PM" and "Visitor here": one read of the
 * last day's charted checks and one of open visits, for the whole building.
 * Either read failing leaves its half empty; the list still shows.
 */
export async function fetchFloorResidentActivity(supabase: Client, facilityId: string, now: Date = new Date()): Promise<FloorResidentActivity> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const [logs, visits] = await Promise.all([
    supabase
      .from("resident_observation_logs")
      .select("resident_id, observed_at")
      .eq("facility_id", facilityId)
      .gte("observed_at", since)
      .is("deleted_at", null)
      .order("observed_at", { ascending: false })
      .limit(2000),
    supabase
      .from("visitor_log_entries" as never)
      .select("resident_id")
      .eq("facility_id", facilityId)
      .not("resident_id", "is", null)
      .is("checked_out_at", null)
      .is("voided_at", null)
      .is("deleted_at", null)
      .gte("checked_in_at", since),
  ]);
  const lastCheckAt = new Map<string, string>();
  for (const row of (logs.error ? [] : logs.data ?? []) as { resident_id: string; observed_at: string }[]) {
    if (!lastCheckAt.has(row.resident_id)) lastCheckAt.set(row.resident_id, row.observed_at);
  }
  const visitorHere = new Set(((visits.error ? [] : visits.data ?? []) as unknown as { resident_id: string }[]).map((row) => row.resident_id));
  return { lastCheckAt, visitorHere };
}

export async function fetchFloorTasks(input: { facilityId: string; residentId?: string; taskId?: string }): Promise<FloorTaskApiRow[]> {
  const params = new URLSearchParams({ facilityId: input.facilityId });
  if (input.residentId) params.set("residentId", input.residentId);
  if (input.taskId) params.set("taskId", input.taskId);
  else params.set("queue", "1");
  const response = await fetch(`/api/rounding/tasks?${params.toString()}`, { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as { error?: string; tasks?: FloorTaskApiRow[] };
  if (!response.ok) throw new Error(json.error ?? "The checks could not be loaded.");
  return json.tasks ?? [];
}

/** The signed-in person's staff row ids (a login can carry more than one). */
export async function fetchMyStaffIds(supabase: Client, userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("staff").select("id").eq("user_id", userId).is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/** The check's choices from `observation_vocab` (places, what they are doing, meal, mood and medication chips). */
export async function fetchFloorCheckVocab(supabase: Client, facilityId: string): Promise<ObservationVocabCatalog> {
  const { data, error } = await supabase
    .from("observation_vocab")
    .select("field_name, value_code, display_label, display_order, is_oof, facility_id")
    .in("field_name", [...FLOOR_CHECK_VOCAB_FIELDS])
    .eq("active", true)
    .is("deleted_at", null)
    .or(`facility_id.eq.${facilityId},facility_id.is.null`);
  if (error) throw error;
  return floorCheckVocabFromRows((data ?? []) as FloorVocabRow[], facilityId);
}
