import { describe, expect, it } from "vitest";
import { buildRoomCensus, roomCensusSummary } from "./room-census";

const rooms = [{ id: "r2", room_number: "2" }, { id: "r12", room_number: "12" }, { id: "r9", room_number: "9" }];
const beds = [
  { id: "b12b", bed_label: "B", room_id: "r12" }, { id: "b12a", bed_label: "A", room_id: "r12" },
  { id: "b9", bed_label: null, room_id: "r9" }, { id: "b2", bed_label: "A", room_id: "r2" },
];
const residents = [
  { id: "1", first_name: "Ann", last_name: "Test", status: "active", bed_id: "b12b" },
  { id: "2", first_name: "Bob", last_name: "Test", status: "hospital_hold", bed_id: "b12a" },
  { id: "3", first_name: "Cy", last_name: "Test", status: "active", bed_id: "b9" },
  { id: "4", first_name: "Di", last_name: "Test", status: "loa", bed_id: "b2" },
  { id: "5", first_name: "Ed", last_name: "Test", status: "active", bed_id: null },
  { id: "6", first_name: "Gone", last_name: "Test", status: "discharged", bed_id: null },
  { id: "7", first_name: "New", last_name: "Test", status: "pending_admission", bed_id: "b9" },
];

describe("current census by room (DEC-2026-09-22-10)", () => {
  it("lists everyone holding a bed, in room and bed order, with where they are", () => {
    const census = buildRoomCensus(residents, beds, rooms);
    expect(census.rows.map((row) => `${row.room}${row.bed} ${row.name} ${row.place}`)).toEqual([
      "2A Di Test On leave", "9 Cy Test In building", "12A Bob Test Hospital or rehab", "12B Ann Test In building", " Ed Test In building",
    ]);
  });
  it("counts who is in the building separately and flags anyone without a room", () => {
    const census = buildRoomCensus(residents, beds, rooms);
    expect(census).toMatchObject({ inBuilding: 3, away: 2, withoutRoom: 1 });
    expect(roomCensusSummary(census)).toBe("3 in the building · 2 away (hospital, rehab or leave), bed held · 1 with no room recorded in Haven — find them before relying on this sheet.");
    expect(roomCensusSummary(buildRoomCensus(residents.slice(0, 1), beds, rooms))).toBe("1 in the building · 0 away (hospital, rehab or leave), bed held.");
  });
});
