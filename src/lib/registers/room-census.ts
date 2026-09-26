/**
 * DEC-2026-09-22-10: the first thing a surveyor asks for, and the thing a
 * fire crew needs at the door, is who is in the building right now and which
 * room and bed they are in ("the firemen need to go to 12B"). This is that
 * sheet: every resident holding a bed, sorted by room and bed, in-building
 * residents first counted separately from those at a hospital or on leave.
 *
 * It is a live snapshot at print time, not a range, and is only as current as
 * the roster: a move not recorded in Haven prints the old room. The printout
 * says when it was produced so an old copy is recognisable.
 */
import { formatPersonName } from "@/lib/format/datetime";
import { BED_HOLDING_RESIDENT_STATUSES } from "@/lib/stand-up/bed-classification";

export type RoomCensusResident = { id: string; first_name: string | null; last_name: string | null; status: string | null; bed_hold_stay_type?: string | null; bed_id: string | null };
export type RoomCensusBed = { id: string; bed_label: string | null; room_id: string };
export type RoomCensusRoom = { id: string; room_number: string | null };

export type RoomCensusRow = { residentId: string; name: string; room: string; bed: string; place: "In building" | "Hospital" | "Rehab" | "Hospital or rehab" | "On leave" };
export type RoomCensus = { rows: RoomCensusRow[]; inBuilding: number; away: number; withoutRoom: number };

const PLACE: Record<string, RoomCensusRow["place"]> = { active: "In building", hospital_hold: "Hospital or rehab", loa: "On leave" };
const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export function buildRoomCensus(residents: RoomCensusResident[], beds: RoomCensusBed[], rooms: RoomCensusRoom[]): RoomCensus {
  const bedById = new Map(beds.map((bed) => [bed.id, bed]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const rows = residents
    .filter((resident) => (BED_HOLDING_RESIDENT_STATUSES as readonly string[]).includes(resident.status ?? ""))
    .map<RoomCensusRow>((resident) => {
      const bed = resident.bed_id ? bedById.get(resident.bed_id) : undefined;
      const room = bed ? roomById.get(bed.room_id) : undefined;
      const name = formatPersonName(resident, { fallback: "Name not recorded" });
      return { residentId: resident.id, name, room: room?.room_number ?? "", bed: bed?.bed_label ?? "", place: resident.status === "hospital_hold" && resident.bed_hold_stay_type === "rehab" ? "Rehab" : resident.status === "hospital_hold" && resident.bed_hold_stay_type === "hospital" ? "Hospital" : PLACE[resident.status ?? ""] };
    })
    .sort((a, b) => {
      // A resident with no room recorded goes last, where the gap is obvious.
      if (!a.room !== !b.room) return a.room ? -1 : 1;
      return collator.compare(a.room, b.room) || collator.compare(a.bed, b.bed) || collator.compare(a.name, b.name);
    });
  return {
    rows,
    inBuilding: rows.filter((row) => row.place === "In building").length,
    away: rows.filter((row) => row.place !== "In building").length,
    withoutRoom: rows.filter((row) => !row.room).length,
  };
}

export function roomCensusSummary(census: RoomCensus): string {
  const parts = [`${census.inBuilding} in the building`, `${census.away} away (hospital, rehab or leave), bed held`];
  if (census.withoutRoom > 0) parts.push(`${census.withoutRoom} with no room recorded in Haven — find them before relying on this sheet`);
  return `${parts.join(" · ")}.`;
}
